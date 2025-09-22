import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import axios from 'axios';
import SFTPClient from 'ssh2-sftp-client';
import { fileURLToPath } from 'url';
import { generateIndexHtml } from './openai.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== ENV ======
const PORT = process.env.PORT || 5050;
const NODE_ENV = process.env.NODE_ENV || 'production';

// CORS
const originsEnv = process.env.CORS_ORIGINS || '*';
const corsOptions = originsEnv === '*'
  ? { origin: true }
  : {
      origin: function (origin, callback) {
        const allowed = originsEnv.split(',').map(s => s.trim());
        if (!origin || allowed.includes(origin)) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
    };

// cPanel & SFTP (untuk publish otomatis)
const CPANEL_HOST = process.env.CPANEL_HOST;                 // contoh: planet.my.id
const CPANEL_USER = process.env.CPANEL_USER;                 // contoh: useobrixlabs
const CPANEL_TOKEN = process.env.CPANEL_TOKEN;               // API Token
const CPANEL_DOCROOT_BASE = process.env.CPANEL_DOCROOT_BASE; // /home/<user>/public_html/sites

const SFTP_HOST = process.env.SFTP_HOST || CPANEL_HOST;
const SFTP_PORT = parseInt(process.env.SFTP_PORT || '22', 10);
const SFTP_USER = process.env.SFTP_USER || CPANEL_USER;
const SFTP_PASS = process.env.SFTP_PASS;
const SFTP_BASE_DIR = process.env.SFTP_BASE_DIR || CPANEL_DOCROOT_BASE;

// ====== APP ======
const app = express();
app.use(cors(corsOptions));
app.use(express.json({ limit: '15mb' }));

// ====== Uploads (logo/background) ======
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = Date.now() + '-' + (file.originalname || 'file');
    cb(null, safe.replace(/[^a-zA-Z0-9._-]/g, '_'));
  },
});
const upload = multer({ storage });

// Serve file upload (untuk preview di UI sebelum publish)
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: NODE_ENV === 'production' ? '1d' : 0,
}));

// ====== Health ======
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'obrix-website-generator',
    time: new Date().toISOString(),
  });
});

// ====== Upload API (logo/background) ======
app.post('/api/upload-logo', upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ ok: true, path: `/uploads/${req.file.filename}` });
});

app.post('/api/upload-background', upload.single('background'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ ok: true, path: `/uploads/${req.file.filename}` });
});

// ====== Generate HTML dari OpenAI ======
app.post('/api/generate', async (req, res) => {
  try {
    const {
      name,
      ticker,
      description,
      logoUrl,
      backgroundUrl,
      theme = 'dark',
      accent = '#7c3aed',
      layout = 'hero',
      bgColor = '#0b0b0b',
    } = req.body || {};

    if (!name || !ticker || !description) {
      return res.status(400).json({ error: 'name, ticker, description are required' });
    }

    const html = await generateIndexHtml({
      name,
      ticker,
      description,
      logoUrl,
      backgroundUrl,
      theme,
      accent,
      layout,
      bgColor,
    });

    res.json({ ok: true, html });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate HTML' });
  }
});

// ====== Generate ZIP (index.html + aset lokal bila ada) ======
app.post('/api/generate-zip', async (req, res) => {
  try {
    const {
      name,
      ticker,
      description,
      logoUrl,
      backgroundUrl,
      theme = 'dark',
      accent = '#7c3aed',
      layout = 'hero',
      bgColor = '#0b0b0b',
    } = req.body || {};

    if (!name || !ticker || !description) {
      return res.status(400).json({ error: 'name, ticker, description are required' });
    }

    const htmlRaw = await generateIndexHtml({
      name, ticker, description, logoUrl, backgroundUrl, theme, accent, layout, bgColor,
    });

    // kumpulkan file lokal /uploads/*
    const assetsLocal = collectLocalAssets(htmlRaw);
    const html = rewriteHtmlUploadsToAssets(htmlRaw);

    const zipName = `${(name || 'site').replace(/[^a-z0-9_-]/gi, '_')}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => { throw err; });
    archive.pipe(res);

    archive.append(html, { name: 'index.html' });
    for (const a of assetsLocal) {
      archive.append(a.data, { name: a.path });
    }

    await archive.finalize();
  } catch (err) {
    console.error('ZIP error:', err);
    res.status(500).json({ error: err.message || 'Failed to create ZIP' });
  }
});

// ====== PUBLISH ======
// - pastikan subdomain ada (cPanel UAPI)
// - upload index.html & assets ke dua lokasi docroot (sites/<sub> dan public_html/<sub>)
app.post('/api/publish', async (req, res) => {
  try {
    let { subdomain, html, assets = [] } = req.body || {};
    if (!subdomain || !html) {
      return res.status(400).json({ error: 'subdomain dan html wajib diisi' });
    }

    // 1) pastikan subdomain ada (abaikan error kalau sudah ada)
    await ensureSubdomainExists(subdomain.toLowerCase());

    // 2) tarik file lokal /uploads/* yang direferensikan di HTML
    const localAssets = collectLocalAssets(html);

    // 3) rewrite HTML ke ./assets/<file>
    const rewrittenHtml = rewriteHtmlUploadsToAssets(html);

    // 4) bungkus file publish
    const publishFiles = [{ path: 'index.html', data: Buffer.from(rewrittenHtml, 'utf8') }];

    // assets base64 dari frontend (opsional)
    for (const a of assets) {
      if (!a?.path || !a?.base64) continue;
      const safe = a.path.replace(/^\/*/, '').replace(/\.\./g, '');
      publishFiles.push({ path: safe, data: Buffer.from(a.base64, 'base64') });
    }

    // assets lokal dari /uploads
    for (const a of localAssets) publishFiles.push(a);

    // 5) upload ke dua lokasi
    const result = await uploadToPaths({ sub: subdomain.toLowerCase(), files: publishFiles });

    res.json({ ok: true, url: result.publicUrl });
  } catch (err) {
    console.error('Publish error:', err?.response?.data || err);
    res.status(500).json({ error: err.message || 'Publish failed' });
  }
});

// ====== Helper: parsing referensi /uploads/* di HTML ======
function findLocalUploadRefs(html) {
  const refs = new Set();

  const imgRe = /<img[^>]+src=["'](\/uploads\/[^"']+)["']/gi;
  const srcRe = /<source[^>]+src=["'](\/uploads\/[^"']+)["']/gi;
  const cssUrlRe = /url\((['"]?)(\/uploads\/[^"')]+)\1\)/gi;
  const linkRe = /<link[^>]+href=["'](\/uploads\/[^"']+)["']/gi;
  const posterRe = /poster=["'](\/uploads\/[^"']+)["']/gi;
  const srcsetRe = /srcset=["']([^"']+)["']/gi;

  let m;
  while ((m = imgRe.exec(html))) refs.add(m[1]);
  while ((m = srcRe.exec(html))) refs.add(m[1]);
  while ((m = cssUrlRe.exec(html))) refs.add(m[2]);
  while ((m = linkRe.exec(html))) refs.add(m[1]);
  while ((m = posterRe.exec(html))) refs.add(m[1]);

  let sm;
  while ((sm = srcsetRe.exec(html))) {
    const parts = sm[1].split(',').map(s => s.trim().split(' ')[0]);
    parts.forEach(p => { if (p.startsWith('/uploads/')) refs.add(p); });
  }
  return Array.from(refs);
}

function rewriteHtmlUploadsToAssets(html) {
  return html
    .replace(/url\((['"]?)(\/uploads\/[^"')]+)\1\)/gi, (full, q, p) => `url(${q || ''}./assets/${path.basename(p)}${q || ''})`)
    .replace(/(src|href|poster)=["'](\/uploads\/[^"']+)["']/gi, (full, attr, p) => `${attr}="./assets/${path.basename(p)}"`)
    .replace(/srcset=["']([^"']+)["']/gi, (full, list) => {
      const items = list.split(',').map(s => {
        const [u, d] = s.trim().split(/\s+/);
        if (u && u.startsWith('/uploads/')) {
          return `./assets/${path.basename(u)}${d ? ' ' + d : ''}`;
        }
        return s.trim();
      });
      return `srcset="${items.join(', ')}"`;
    });
}

function collectLocalAssets(html) {
  const refs = findLocalUploadRefs(html);
  const assets = [];
  for (const rel of refs) {
    const abs = path.join(UPLOAD_DIR, path.basename(rel));
    if (fs.existsSync(abs)) {
      const buf = fs.readFileSync(abs);
      assets.push({ path: `assets/${path.basename(rel)}`, data: buf });
    }
  }
  return assets;
}

// ====== cPanel: pastikan subdomain ada ======
async function ensureSubdomainExists(sub) {
  if (!CPANEL_HOST || !CPANEL_USER || !CPANEL_TOKEN || !CPANEL_DOCROOT_BASE) {
    throw new Error('CPANEL_* env belum lengkap');
  }

  // cek apakah sudah ada
  const listUrl = `https://${CPANEL_HOST}:2083/execute/SubDomain/listsubdomains?regex=${encodeURIComponent(`^${sub}\\.`)}&regex_type=escape`;
  const headers = { Authorization: `cpanel ${CPANEL_USER}:${CPANEL_TOKEN}` };
  const list = await axios.get(listUrl, { headers, timeout: 20000 }).then(r => r.data);

  const exists = (list?.data || []).some(d => d.domain?.startsWith(`${sub}.`));
  if (exists) return true;

  // buat subdomain → docroot = CPANEL_DOCROOT_BASE/<sub>
  const docroot = `${CPANEL_DOCROOT_BASE.replace(/\/+$/, '')}/${sub}`;
  const addUrl = `https://${CPANEL_HOST}:2083/execute/SubDomain/addsubdomain?domain=${sub}&rootdomain=${encodeURIComponent(process.env.ROOT_DOMAIN || 'useobrixlabs.com')}&dir=${encodeURIComponent(docroot)}&disallowdot=1`;
  const add = await axios.get(addUrl, { headers, timeout: 20000 }).then(r => r.data);

  if (add?.status !== 1) {
    console.warn('Subdomain add response:', add);
    // beberapa server menolak add jika sudah ada—anggap OK
  }
  return true;
}

// ====== SFTP Upload ke dua lokasi ======
async function uploadToPaths({ sub, files }) {
  const client = new SFTPClient();
  const publicUrl = `https://${sub}.${process.env.ROOT_DOMAIN || 'useobrixlabs.com'}`;

  // dua target (utama & fallback)
  const targetA = `${SFTP_BASE_DIR.replace(/\/+$/, '')}/${sub}`;         // /home/<user>/public_html/sites/<sub>
  const targetB = `/home/${SFTP_USER}/public_html/${sub}`;               // fallback: /home/<user>/public_html/<sub>

  try {
    await client.connect({
      host: SFTP_HOST,
      port: SFTP_PORT,
      username: SFTP_USER,
      password: SFTP_PASS,
      readyTimeout: 20000,
    });

    // helper mkdir -p
    async function mkdirp(dir) {
      const parts = dir.split('/').filter(Boolean);
      let cur = '';
      for (const p of parts) {
        cur += `/${p}`;
        try { // eslint-disable-next-line no-await-in-loop
          await client.mkdir(cur, true);
        } catch (_) { /* ignore */ }
      }
    }

    // upload ke A dan B
    for (const base of [targetA, targetB]) {
      await mkdirp(base);
      // hapus assets lama (opsional—supaya bersih)
      try { await client.rmdir(`${base}/assets`, true); } catch (_) { /* ignore */ }
      await mkdirp(`${base}/assets`);

      for (const f of files) {
        const remote = `${base}/${f.path.replace(/^\/*/, '')}`;
        const dir = path.posix.dirname(remote);
        await mkdirp(dir);
        await client.put(f.data, remote);
      }
    }
  } finally {
    try { await client.end(); } catch (_) { /* ignore */ }
  }

  return { publicUrl };
}

// ====== START ======
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend running on http://0.0.0.0:${PORT}`);
});
