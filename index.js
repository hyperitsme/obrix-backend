// index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { fileURLToPath } from 'url';
import mime from 'mime-types';
import { generateIndexHtml } from './openai.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== App & CORS ======
const app = express();
const PORT = process.env.PORT || 5050;

const originsEnv = process.env.CORS_ORIGINS || '*';
const corsOptions = originsEnv === '*'
  ? { origin: true }
  : {
      origin: function (origin, callback) {
        const allowed = originsEnv.split(',').map(s => s.trim());
        if (!origin || allowed.includes(origin)) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true
    };

app.use(cors(corsOptions));
app.use(express.json({ limit: '15mb' }));

// ====== Uploads ======
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const base = Date.now() + '-' + (file.originalname || 'file');
    cb(null, base.replace(/[^a-zA-Z0-9._-]/g, '_'));
  }
});
const upload = multer({ storage });

// Serve files
app.use('/uploads', express.static(UPLOAD_DIR));

// ====== Utils ======
function toPublicUrl(req, rel) {
  if (!rel) return '';
  if (/^https?:\/\//i.test(rel)) return rel;
  if (rel.startsWith('/uploads/')) {
    // bangun absolute host dari request
    const base = `${req.protocol}://${req.get('host')}`;
    return base + rel;
  }
  return rel;
}

function stripCodeFences(s) {
  if (!s) return s;
  // buang ```html … ```
  return String(s)
    .replace(/^[\s`]*html\b/i, '')
    .replace(/```/g, '')
    .trim();
}

function readAsDataUri(absPath) {
  try {
    if (!absPath || !fs.existsSync(absPath)) return '';
    const buf = fs.readFileSync(absPath);
    const ext = path.extname(absPath).slice(1) || 'png';
    const mt = mime.lookup(ext) || 'application/octet-stream';
    return `data:${mt};base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

/**
 * Inline SEMUA kemunculan /uploads/... menjadi data:uri (agar preview selalu tampil).
 */
function inlineUploadsAsDataUri(html) {
  let out = String(html || '');
  // src="/uploads/..."
  out = out.replace(/src=["'](\/uploads\/[^"']+)["']/gi, (m, rel) => {
    const abs = path.join(UPLOAD_DIR, path.basename(rel));
    const data = readAsDataUri(abs);
    return data ? `src="${data}"` : m;
  });
  // url(/uploads/...)
  out = out.replace(/url\((['"]?)(\/uploads\/[^)'"]+)\1\)/gi, (m, q, rel) => {
    const abs = path.join(UPLOAD_DIR, path.basename(rel));
    const data = readAsDataUri(abs);
    return data ? `url(${data})` : m;
  });
  return out;
}

/**
 * Paksa logo & background muncul.
 * - Preview: pakai data URI (tidak tergantung jaringan).
 * - ZIP: pakai path relatif ./assets/...
 * - Tambah body::before agar background SELALU terlihat.
 */
function injectAssets(html, { logoUrl, backgroundUrl, bgColor = '#0b0b0b' }, mode) {
  let out = String(html || '');

  // pastikan <head> dan </body> ada
  if (!/<\/head>/i.test(out)) out = out.replace(/<html[^>]*>/i, '$&\n<head></head>');
  if (!/<\/body>/i.test(out)) out = out.replace(/<\/head>/i, '</head>\n<body>\n</body>');

  // var dasar
  if (!out.includes('--obrix-bg-color')) {
    out = out.replace(/<\/head>/i, `<style>:root{--obrix-bg-color:${bgColor};}</style>\n</head>`);
  }

  // ===== background =====
  if (backgroundUrl) {
    let bgRef = '';
    if (mode === 'preview') {
      const abs = path.join(UPLOAD_DIR, path.basename(backgroundUrl));
      bgRef = readAsDataUri(abs);
    } else {
      bgRef = `./assets/${path.basename(backgroundUrl)}`;
    }
    if (bgRef) {
      const cssBg = `
html,body{height:100%;}
body{background-color:var(--obrix-bg-color) !important;}
body::before{
  content:"";
  position:fixed;
  inset:0;
  z-index:-1;
  background-image:url("${bgRef}");
  background-size:cover;
  background-position:center;
  background-repeat:no-repeat;
  opacity:1;
  pointer-events:none;
}
`;
      out = out.replace(/<\/head>/i, `<style>${cssBg}</style>\n</head>`);
    }
  }

  // ===== logo =====
  if (logoUrl) {
    let tag = '';
    if (mode === 'preview') {
      const abs = path.join(UPLOAD_DIR, path.basename(logoUrl));
      const data = readAsDataUri(abs);
      if (data) tag = `<img src="${data}" alt="Logo" class="site-logo" style="height:56px;width:auto;display:block;margin:0 auto 16px;" />`;
    } else {
      tag = `<img src="./assets/${path.basename(logoUrl)}" alt="Logo" class="site-logo" style="height:56px;width:auto;display:block;margin:0 auto 16px;" />`;
    }

    if (tag) {
      if (out.includes('<!--OBRIX_LOGO_HERE-->')) {
        out = out.replace('<!--OBRIX_LOGO_HERE-->', tag);
      } else if (!/class=["']site-logo["']/.test(out)) {
        out = out.replace(/<body[^>]*>/i, `$&\n${tag}`);
      }
    }
  }

  return out;
}

// ====== Routes ======
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'obrix-website-generator', time: new Date().toISOString() });
});

// Upload endpoints (opsional — front-end boleh pakai /api/upload-logo saja)
app.post('/api/upload-logo', upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const rel = `/uploads/${req.file.filename}`;
  res.json({ ok: true, path: rel, url: toPublicUrl(req, rel) });
});
app.post('/api/upload-background', upload.single('background'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const rel = `/uploads/${req.file.filename}`;
  res.json({ ok: true, path: rel, url: toPublicUrl(req, rel) });
});

// Generate preview HTML
app.post('/api/generate', async (req, res) => {
  try {
    const {
      name, ticker, description,
      theme = 'dark', accent = '#7c3aed', layout = 'hero',
      bgColor = '#0b0b0b'
    } = req.body || {};

    if (!name || !ticker || !description) {
      return res.status(400).json({ error: 'name, ticker, description are required' });
    }

    // terima berbagai nama field
    const logoRel = req.body.logoUrl || req.body.logoPath || req.body.logo || '';
    const bgRel   = req.body.backgroundUrl || req.body.backgroundPath || req.body.background || '';

    const logoForAi = toPublicUrl(req, logoRel);
    const bgForAi   = toPublicUrl(req, bgRel);

    let htmlRaw = await generateIndexHtml({
      name, ticker, description, theme, accent, layout,
      logoUrl: logoForAi, backgroundUrl: bgForAi, bgColor
    });

    let html = stripCodeFences(htmlRaw);
    html = injectAssets(html, { logoUrl: logoRel, backgroundUrl: bgRel, bgColor }, 'preview');
    html = inlineUploadsAsDataUri(html);

    res.json({ ok: true, html });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate HTML' });
  }
});

// Generate ZIP (index.html + assets/)
app.post('/api/generate-zip', async (req, res) => {
  try {
    const {
      name, ticker, description,
      theme = 'dark', accent = '#7c3aed', layout = 'hero',
      bgColor = '#0b0b0b'
    } = req.body || {};

    if (!name || !ticker || !description) {
      return res.status(400).json({ error: 'name, ticker, description are required' });
    }

    const logoRel = req.body.logoUrl || req.body.logoPath || req.body.logo || '';
    const bgRel   = req.body.backgroundUrl || req.body.backgroundPath || req.body.background || '';

    const logoForZip = logoRel ? ('./assets/' + path.basename(logoRel)) : '';
    const bgForZip   = bgRel   ? ('./assets/' + path.basename(bgRel))   : '';

    let htmlRaw = await generateIndexHtml({
      name, ticker, description, theme, accent, layout,
      logoUrl: logoForZip, backgroundUrl: bgForZip, bgColor
    });

    let html = stripCodeFences(htmlRaw);
    html = injectAssets(html, { logoUrl: logoRel, backgroundUrl: bgRel, bgColor }, 'zip');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${(name || 'site').replace(/[^a-z0-9_-]/gi, '_')}.zip"`
    );

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => { throw err; });
    archive.pipe(res);

    // index.html
    archive.append(html, { name: 'index.html' });

    // assets (jika ada)
    if (logoRel) {
      const abs = path.join(UPLOAD_DIR, path.basename(logoRel));
      if (fs.existsSync(abs)) archive.file(abs, { name: `assets/${path.basename(abs)}` });
    }
    if (bgRel) {
      const abs = path.join(UPLOAD_DIR, path.basename(bgRel));
      if (fs.existsSync(abs)) archive.file(abs, { name: `assets/${path.basename(abs)}` });
    }

    await archive.finalize();
  } catch (err) {
    console.error('ZIP error:', err);
    res.status(500).json({ error: err.message || 'Failed to create ZIP' });
  }
});

// listen 0.0.0.0 (Render/hosting)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend running on http://0.0.0.0:${PORT}`);
});
