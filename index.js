import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { fileURLToPath } from 'url';
import { generateIndexHtml } from './openai.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5050;

// ===== CORS =====
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
app.use(express.json({ limit: '15mb' }));

// ===== Uploads =====
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const base = (file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${base}`);
  },
});
const upload = multer({ storage });

app.use('/uploads', express.static(UPLOAD_DIR));

// ===== Helpers =====
const PUBLIC_UPLOAD_BASE =
  process.env.PUBLIC_UPLOAD_BASE || `https://api.useobrixlabs.com`;

function toPublicUrl(p) {
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  if (!p.startsWith('/')) p = '/' + p;
  // contoh: /uploads/xxx.jpg -> https://api.useobrixlabs.com/uploads/xxx.jpg
  return `${PUBLIC_UPLOAD_BASE}${p}`;
}

function stripCodeFences(html) {
  if (!html) return html;
  let out = html.replace(/^\s*```(?:html)?\s*/i, '');
  out = out.replace(/\s*```+\s*$/i, '');
  return out;
}

function readAsDataUri(absPath) {
  if (!fs.existsSync(absPath)) return null;
  const buf = fs.readFileSync(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const mime =
    ext === '.png'
      ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.gif'
      ? 'image/gif'
      : ext === '.webp'
      ? 'image/webp'
      : ext === '.svg'
      ? 'image/svg+xml'
      : 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * Sisipkan logo & background meski model tidak taruh sendiri.
 * - preview: pakai dataURI (agar pasti tampil)
 * - zip/publish: pakai ./assets/...
 */
function injectAssets(html, { logoUrl, backgroundUrl, bgColor = '#0b0b0b' }, mode) {
  let out = String(html || '');

  // Pastikan <head> & </body> ada
  if (!/<\/head>/i.test(out)) out = out.replace(/<html[^>]*>/i, '$&\n<head></head>');
  if (!/<\/body>/i.test(out)) out = out.replace(/<\/head>/i, '</head>\n<body>\n</body>');

  // Tambah CSS variables bila belum ada
  const cssVar = `:root{--obrix-bg-color:${bgColor};}`;
  if (!out.includes('--obrix-bg-color')) {
    out = out.replace(
      /<\/head>/i,
      `<style>${cssVar}</style>\n</head>`
    );
  }

  // ===== Background =====
  if (backgroundUrl) {
    let bgRef = '';
    if (mode === 'preview') {
      const abs = path.join(UPLOAD_DIR, path.basename(backgroundUrl));
      const dataUri = readAsDataUri(abs);
      if (dataUri) bgRef = `url("${dataUri}")`;
    } else {
      // zip / publish
      bgRef = `url("./assets/${path.basename(backgroundUrl)}")`;
    }

    if (bgRef) {
      if (!/background-image\s*:/i.test(out)) {
        // sisipkan di head
        out = out.replace(
          /<\/head>/i,
          `<style>body{background:${bgColor};background-image:${bgRef};background-size:cover;background-position:center;background-repeat:no-repeat;}</style>\n</head>`
        );
      } else {
        // ganti yang ada (opsional)
        out = out.replace(
          /background-image\s*:\s*[^;]+;/i,
          `background-image:${bgRef};`
        );
      }
    }
  }

  // ===== Logo =====
  if (logoUrl) {
    let logoTag = '';
    if (mode === 'preview') {
      const abs = path.join(UPLOAD_DIR, path.basename(logoUrl));
      const dataUri = readAsDataUri(abs);
      if (dataUri) {
        logoTag = `<img src="${dataUri}" alt="Logo" class="site-logo" style="height:56px;width:auto;display:block;margin:0 auto 16px;" />`;
      }
    } else {
      logoTag = `<img src="./assets/${path.basename(
        logoUrl
      )}" alt="Logo" class="site-logo" style="height:56px;width:auto;display:block;margin:0 auto 16px;" />`;
    }

    if (logoTag) {
      if (out.includes('<!--OBRIX_LOGO_HERE-->')) {
        out = out.replace('<!--OBRIX_LOGO_HERE-->', logoTag);
      } else if (!/class=["']site-logo["']/.test(out)) {
        // taruh di dekat awal body
        out = out.replace(/<body[^>]*>/i, `$&\n${logoTag}`);
      }
    }
  }

  return out;
}

/** Inline semua /uploads/... yg tersisa jadi data URI (backup) */
function inlineUploadsAsDataUri(html) {
  const collect = new Set();

  html.replace(/(src|href|poster)=["'](\/uploads\/[^"']+)["']/gi, (m, a, p) => {
    collect.add(p);
    return m;
  });
  html.replace(/url\((['"]?)(\/uploads\/[^"')]+)\1\)/gi, (m, q, p) => {
    collect.add(p);
    return m;
  });
  html.replace(/srcset=["']([^"']+)["']/gi, (m, list) => {
    list.split(',').forEach((item) => {
      const u = item.trim().split(/\s+/)[0];
      if (u && u.startsWith('/uploads/')) collect.add(u);
    });
    return m;
  });

  let out = html;
  for (const p of collect) {
    const abs = path.join(UPLOAD_DIR, path.basename(p));
    const dataUri = readAsDataUri(abs);
    if (!dataUri) continue;

    // src/href/poster
    out = out.replace(
      new RegExp(`(src|href|poster)=["']${p.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}["']`, 'gi'),
      (m, attr) => `${attr}="${dataUri}"`
    );
    // CSS url(...)
    out = out
      .replace(
        new RegExp(`url\\((['"])${p.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\1\\)`, 'gi'),
        (m, q) => `url(${q}${dataUri}${q})`
      )
      .replace(
        new RegExp(`url\\(${p.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\)`, 'gi'),
        () => `url(${dataUri})`
      );
    // srcset
    out = out.replace(
      new RegExp(`(\\s|,|^)${p.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(\\s|,|$)`, 'gi'),
      (m, b, a) => `${b}${dataUri}${a}`
    );
  }
  return out;
}

// ===== Routes =====
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'obrix-website-generator', time: new Date().toISOString() });
});

// upload logo
app.post('/api/upload-logo', upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const rel = `/uploads/${req.file.filename}`;
  res.json({ ok: true, path: rel, url: toPublicUrl(rel) });
});

// upload background
app.post('/api/upload-background', upload.single('background'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const rel = `/uploads/${req.file.filename}`;
  res.json({ ok: true, path: rel, url: toPublicUrl(rel) });
});

// Generate (PREVIEW) – gambar di-inline sebagai data URI
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

    let htmlRaw = await generateIndexHtml({
      name,
      ticker,
      description,
      logoUrl: toPublicUrl(logoUrl || ''),
      backgroundUrl: toPublicUrl(backgroundUrl || ''),
      theme,
      accent,
      layout,
      bgColor,
    });

    let html = stripCodeFences(htmlRaw);
    html = injectAssets(html, { logoUrl, backgroundUrl, bgColor }, 'preview');
    html = inlineUploadsAsDataUri(html);

    res.json({ ok: true, html });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate HTML' });
  }
});

// Generate ZIP – gambar ke ./assets/ dan referensi diubah
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

    let htmlRaw = await generateIndexHtml({
      name,
      ticker,
      description,
      logoUrl: './assets/' + (logoUrl ? path.basename(logoUrl) : ''),
      backgroundUrl: './assets/' + (backgroundUrl ? path.basename(backgroundUrl) : ''),
      theme,
      accent,
      layout,
      bgColor,
    });

    let html = stripCodeFences(htmlRaw);
    html = injectAssets(html, { logoUrl, backgroundUrl, bgColor }, 'zip');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${(name || 'site').replace(/[^a-z0-9_-]/gi, '_')}.zip"`
    );

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      throw err;
    });
    archive.pipe(res);

    archive.append(html, { name: 'index.html' });

    // Tambah assets jika ada
    if (logoUrl && logoUrl.startsWith('/uploads/')) {
      const abs = path.join(UPLOAD_DIR, path.basename(logoUrl));
      if (fs.existsSync(abs)) {
        archive.file(abs, { name: `assets/${path.basename(abs)}` });
      }
    }
    if (backgroundUrl && backgroundUrl.startsWith('/uploads/')) {
      const abs = path.join(UPLOAD_DIR, path.basename(backgroundUrl));
      if (fs.existsSync(abs)) {
        archive.file(abs, { name: `assets/${path.basename(abs)}` });
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error('ZIP error:', err);
    res.status(500).json({ error: err.message || 'Failed to create ZIP' });
  }
});

// listen di 0.0.0.0 (untuk Render)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend running on http://0.0.0.0:${PORT}`);
});
