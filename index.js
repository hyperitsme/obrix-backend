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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5050;

/* ------------------------ CORS ------------------------ */
const originsEnv = process.env.CORS_ORIGINS || '*';
const corsOptions =
  originsEnv === '*'
    ? { origin: true, credentials: true }
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

/* --------------------- Uploads (multer) --------------------- */
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const base = file.originalname || 'file';
    const safe = `${Date.now()}-${base}`.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safe);
  },
});
const upload = multer({ storage });

/* ------------------------ Static files ------------------------ */
app.use('/uploads', express.static(UPLOAD_DIR));

/* ------------------------ Healthcheck ------------------------ */
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'obrix-website-generator',
    time: new Date().toISOString(),
  });
});

/* ------------------------ Upload endpoints ------------------------ */
// Logo
app.post('/api/upload-logo', upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filePath = `/uploads/${req.file.filename}`;
  res.json({ ok: true, path: filePath });
});

// Background (opsional — kalau frontend mau endpoint terpisah)
app.post('/api/upload-background', upload.single('background'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filePath = `/uploads/${req.file.filename}`;
  res.json({ ok: true, path: filePath });
});

/* ------------------------ Helpers ------------------------ */
// Untuk PREVIEW (iframe/blob): ubah /uploads/... -> https://api.useobrixlabs.com/uploads/...
function absolutizeUploads(html, base) {
  let out = html;

  // url(...) di CSS
  out = out.replace(/url\((['"]?)(\/uploads\/[^"')]+)\1\)/gi, (full, q, p) => {
    return `url(${q || ''}${base}${p}${q || ''})`;
  });

  // src=, href=, poster=
  out = out.replace(
    /(src|href|poster)=["'](\/uploads\/[^"']+)["']/gi,
    (full, attr, p) => `${attr}="${base}${p}"`
  );

  // srcset="..., /uploads/.. 2x, /uploads/.. 1x"
  out = out.replace(/srcset=["']([^"']+)["']/gi, (full, list) => {
    const items = list.split(',').map((s) => {
      const [u, d] = s.trim().split(/\s+/);
      if (u && u.startsWith('/uploads/')) {
        return `${base}${u}${d ? ' ' + d : ''}`;
      }
      return s.trim();
    });
    return `srcset="${items.join(', ')}"`;
  });

  return out;
}

// Untuk ZIP/PUBLISH: rewrite /uploads/... -> ./assets/<filename>
function rewriteHtmlUploadsToAssets(html) {
  let out = html;

  // CSS url(...)
  out = out.replace(/url\((['"]?)(\/uploads\/([^"')]+))\1\)/gi, (m, q, full, file) => {
    return `url(${q || ''}./assets/${file}${q || ''})`;
  });

  // src, href, poster
  out = out.replace(
    /(src|href|poster)=["']\/uploads\/([^"']+)["']/gi,
    (m, attr, file) => `${attr}="./assets/${file}"`
  );

  // srcset
  out = out.replace(/srcset=["']([^"']+)["']/gi, (full, list) => {
    const items = list.split(',').map((s) => {
      const [u, d] = s.trim().split(/\s+/);
      if (u && u.startsWith('/uploads/')) {
        return `./assets/${u.replace('/uploads/', '')}${d ? ' ' + d : ''}`;
      }
      return s.trim();
    });
    return `srcset="${items.join(', ')}"`;
  });

  return out;
}

/* ------------------------ Generate (preview) ------------------------ */
app.post('/api/generate', async (req, res) => {
  try {
    const {
      name,
      ticker,
      description,
      logoUrl,        // contoh: /uploads/123-logo.png atau URL penuh
      backgroundUrl,  // contoh: /uploads/456-bg.jpg atau URL penuh
      theme = 'dark',
      accent = '#7c3aed',
      layout = 'hero',
      bgColor = '#0b0b0b',
    } = req.body || {};

    if (!name || !ticker || !description) {
      return res
        .status(400)
        .json({ error: 'name, ticker, description are required' });
    }

    const htmlRaw = await generateIndexHtml({
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

    // FIX PREVIEW: absolutize /uploads untuk origin blob:
    const BASE =
      process.env.PUBLIC_UPLOAD_BASE || `${req.protocol}://${req.get('host')}`;
    const htmlForPreview = absolutizeUploads(htmlRaw, BASE);

    res.json({ ok: true, html: htmlForPreview });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate HTML' });
  }
});

/* ------------------------ Generate ZIP ------------------------ */
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
      return res
        .status(400)
        .json({ error: 'name, ticker, description are required' });
    }

    // Buat HTML dari OpenAI
    const htmlRaw = await generateIndexHtml({
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

    // Rewrite ke ./assets/... untuk bundle ZIP
    const html = rewriteHtmlUploadsToAssets(htmlRaw);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${(name || 'site')
        .replace(/[^a-z0-9_-]/gi, '_')
        .toLowerCase()}.zip"`
    );

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      throw err;
    });
    archive.pipe(res);

    // index.html
    archive.append(html, { name: 'index.html' });

    // Sertakan file logo/background lokal jika berasal dari /uploads
    const maybeAddAsset = (maybeUrl) => {
      if (!maybeUrl) return;
      if (maybeUrl.startsWith('/uploads/')) {
        const filename = path.basename(maybeUrl);
        const abs = path.join(UPLOAD_DIR, filename);
        if (fs.existsSync(abs)) {
          archive.file(abs, { name: `assets/${filename}` });
        }
      }
    };

    maybeAddAsset(logoUrl);
    maybeAddAsset(backgroundUrl);

    await archive.finalize();
  } catch (err) {
    console.error('ZIP error:', err);
    res.status(500).json({ error: err.message || 'Failed to create ZIP' });
  }
});

/* ------------------------ Start server ------------------------ */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend running on http://0.0.0.0:${PORT}`);
});
