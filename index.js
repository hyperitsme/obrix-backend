// index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { fileURLToPath } from 'url';
import { generateIndexHtml } from './openai.js';
import axios from 'axios';
import SFTPClient from 'ssh2-sftp-client';

// ========== Setup dasar ==========
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5050;

// ========== Middleware ==========
const originsEnv = process.env.CORS_ORIGINS || '*';
const corsOptions =
  originsEnv === '*'
    ? { origin: true }
    : {
        origin: function (origin, callback) {
          const allowed = originsEnv.split(',').map((s) => s.trim());
          if (!origin || allowed.includes(origin)) return callback(null, true);
          callback(new Error('Not allowed by CORS'));
        },
        credentials: true,
      };
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// ========== Uploads ==========
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const safe = Date.now() + '-' + (file.originalname || 'file');
    cb(null, safe.replace(/[^a-zA-Z0-9._-]/g, '_'));
  },
});
const upload = multer({ storage });

// ========== Endpoint dasar ==========
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'obrix-website-generator',
    time: new Date().toISOString(),
  });
});

// Upload logo
app.post('/api/upload-logo', upload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filePath = `/uploads/${req.file.filename}`;
  res.json({ ok: true, path: filePath });
});

// Serve uploads statically
app.use('/uploads', express.static(uploadDir));

// Generate HTML
app.post('/api/generate', async (req, res) => {
  try {
    const { name, ticker, description, logoUrl, theme = 'dark', accent = '#7c3aed', layout = 'hero' } = req.body || {};
    if (!name || !ticker || !description) {
      return res.status(400).json({ error: 'name, ticker, description are required' });
    }
    const html = await generateIndexHtml({ name, ticker, description, logoUrl, theme, accent, layout });
    res.json({ ok: true, html });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate HTML' });
  }
});

// Generate ZIP
app.post('/api/generate-zip', async (req, res) => {
  try {
    const { name, ticker, description, logoUrl, theme = 'dark', accent = '#7c3aed', layout = 'hero' } = req.body || {};
    if (!name || !ticker || !description) {
      return res.status(400).json({ error: 'name, ticker, description are required' });
    }
    const html = await generateIndexHtml({ name, ticker, description, logoUrl, theme, accent, layout });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${(name || 'site').replace(/[^a-z0-9_-]/gi, '_')}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      throw err;
    });
    archive.pipe(res);

    archive.append(html, { name: 'index.html' });

    if (logoUrl && logoUrl.startsWith('/uploads/')) {
      const absPath = path.join(uploadDir, path.basename(logoUrl));
      if (fs.existsSync(absPath)) {
        archive.file(absPath, { name: `assets/${path.basename(absPath)}` });
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error('ZIP error:', err);
    res.status(500).json({ error: err.message || 'Failed to create ZIP' });
  }
});

// ========== Helper untuk Publish ==========
async function ensureSubdomainExists(sub) {
  const { CPANEL_HOST, CPANEL_USER, CPANEL_TOKEN } = process.env;
  if (!CPANEL_HOST || !CPANEL_USER || !CPANEL_TOKEN) {
    throw new Error('Missing CPANEL_* envs');
  }
  const desiredDir = `public_html/sites/${sub}`;
  const url = `https://${CPANEL_HOST}:2083/execute/SubDomain/addsubdomain`;
  const params = new URLSearchParams({
    domain: sub,
    rootdomain: 'useobrixlabs.com',
    dir: desiredDir,
  }).toString();

  const resp = await axios.get(`${url}?${params}`, {
    headers: { Authorization: `cpanel ${CPANEL_USER}:${CPANEL_TOKEN}` },
    timeout: 20000,
    validateStatus: () => true,
  });

  const ok = resp?.data?.status === 1;
  if (!ok) {
    const msg = JSON.stringify(resp?.data ?? {});
    if (!msg.toLowerCase().includes('already exists')) {
      throw new Error(`Failed to add subdomain: ${msg}`);
    }
  }

  return {
    desired: `/home/${CPANEL_USER}/${desiredDir}`,
    fallback: `/home/${CPANEL_USER}/public_html/${sub}`,
  };
}

async function uploadToPaths({ sub, files }) {
  const { SFTP_HOST, SFTP_PORT = 22, SFTP_USER, SFTP_PASS } = process.env;
  if (!SFTP_HOST || !SFTP_USER || !SFTP_PASS) {
    throw new Error('Missing SFTP_* envs');
  }

  const sftp = new SFTPClient();
  await sftp.connect({
    host: SFTP_HOST,
    port: Number(SFTP_PORT),
    username: SFTP_USER,
    password: SFTP_PASS,
  });

  const { desired, fallback } = await ensureSubdomainExists(sub);

  const ensureDir = async (dir) => {
    try {
      await sftp.mkdir(dir, true);
    } catch {}
  };

  await ensureDir(desired);
  await ensureDir(fallback);

  const targets = [desired, fallback];

  for (const targetBase of targets) {
    for (const f of files) {
      const remote = `${targetBase}/${f.path}`;
      const folders = f.path.split('/').slice(0, -1);
      if (folders.length) {
        let acc = targetBase;
        for (const folder of folders) {
          acc = `${acc}/${folder}`;
          try {
            await sftp.mkdir(acc, true);
          } catch {}
        }
      }
      await sftp.put(Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data), remote);
    }
  }

  await sftp.end();
  return {
    publicUrl: `https://${sub}.useobrixlabs.com`,
    deployedTo: targets,
  };
}

// ========== Publish Endpoint ==========
app.post('/api/publish', async (req, res) => {
  try {
    const { subdomain, html, assets = [] } = req.body || {};
    if (!subdomain || !html) {
      return res.status(400).json({ error: 'subdomain dan html wajib diisi' });
    }

    const files = [{ path: 'index.html', data: html }];
    for (const a of assets) {
      if (!a?.path || !a?.base64) continue;
      const data = Buffer.from(a.base64, 'base64');
      const safePath = a.path.replace(/^\/*/, '').replace(/\.\./g, '');
      files.push({ path: safePath, data });
    }

    const result = await uploadToPaths({ sub: subdomain.toLowerCase(), files });
    return res.json({ ok: true, url: result.publicUrl });
  } catch (e) {
    console.error('Publish error:', e);
    return res.status(500).json({ error: e.message || 'Publish failed' });
  }
});

// ========== Jalankan Server ==========
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend running on http://0.0.0.0:${PORT}`);
});
