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

// ---------------- CORS ----------------
const originsEnv = process.env.CORS_ORIGINS || '*';
const corsOptions = originsEnv === '*'
  ? { origin: true }
  : {
      origin(origin, callback) {
        const allowed = originsEnv.split(',').map(s => s.trim());
        if (!origin || allowed.includes(origin)) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true
    };
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// ---------------- Uploads ----------------
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const safe = Date.now() + '-' + (file.originalname || 'upload');
    cb(null, safe.replace(/[^a-zA-Z0-9._-]/g, '_'));
  }
});
const upload = multer({ storage });

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'obrix-website-generator', time: new Date().toISOString() });
});

// ✅ Upload (logo / background) → kembalikan URL absolut
app.post('/api/upload-logo', upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filePath = `/uploads/${req.file.filename}`;
  const fullUrl = `${req.protocol}://${req.get('host')}${filePath}`; // absolut
  res.json({ ok: true, url: fullUrl });
});

// Serve uploads statically
app.use('/uploads', express.static(uploadDir, { maxAge: '30d', immutable: true }));

// ---------------- Generate HTML ----------------
app.post('/api/generate', async (req, res) => {
  try {
    const {
      name, ticker, description, logoUrl,
      theme = 'dark', accent = '#7c3aed', layout = 'hero',
      bgColor = '', bgImageUrl = ''
    } = req.body || {};

    if (!name || !ticker || !description) {
      return res.status(400).json({ error: 'name, ticker, description are required' });
    }

    const html = await generateIndexHtml({
      name, ticker, description, logoUrl, theme, accent, layout, bgColor, bgImageUrl
    });

    res.json({ ok: true, html });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate HTML' });
  }
});

// ---------------- Helper untuk ZIP ----------------
function maybeAddLocalUpload(archive, uploadsDir, fileUrl, outName) {
  if (!fileUrl) return;
  try {
    const u = new URL(fileUrl);
    // hanya file yang berasal dari server ini (/uploads/…) yang bisa kita sertakan
    if (u.pathname.startsWith('/uploads/')) {
      const basename = path.basename(u.pathname);
      const absPath = path.join(uploadsDir, basename);
      if (fs.existsSync(absPath)) {
        archive.file(absPath, { name: `assets/${outName || basename}` });
      }
    }
  } catch {
    // bukan URL absolut → lewati
  }
}

// ---------------- Generate ZIP ----------------
app.post('/api/generate-zip', async (req, res) => {
  try {
    const {
      name, ticker, description, logoUrl,
      theme = 'dark', accent = '#7c3aed', layout = 'hero',
      bgColor = '', bgImageUrl = ''
    } = req.body || {};

    if (!name || !ticker || !description) {
      return res.status(400).json({ error: 'name, ticker, description are required' });
    }

    // HTML lengkap
    let html = await generateIndexHtml({
      name, ticker, description, logoUrl, theme, accent, layout, bgColor, bgImageUrl
    });

    // Mode offline untuk ZIP: ganti URL absolut ke assets/… (jika applicable)
    let htmlOut = html;
    const replaceUrlWithAsset = (srcUrl, assetName) => {
      if (!srcUrl) return;
      try {
        const u = new URL(srcUrl);
        if (u.pathname.startsWith('/uploads/')) {
          htmlOut = htmlOut.split(srcUrl).join(`assets/${assetName}`);
        }
      } catch {
        // bukan URL absolut → lewati
      }
    };

    const logoAssetName = logoUrl ? 'logo' + path.extname(logoUrl) : null;
    const bgAssetName = bgImageUrl ? 'background' + path.extname(bgImageUrl) : null;

    replaceUrlWithAsset(logoUrl, logoAssetName || 'logo.png');
    replaceUrlWithAsset(bgImageUrl, bgAssetName || 'background.png');

    // Response headers
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${(name || 'site').replace(/[^a-z0-9_-]/gi, '_')}.zip"`
    );

    // Build ZIP
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => { throw err; });
    archive.pipe(res);

    // index.html (sudah di-replace agar offline)
    archive.append(htmlOut, { name: 'index.html' });

    // Sertakan file-file upload lokal
    maybeAddLocalUpload(archive, uploadDir, logoUrl, logoAssetName || 'logo.png');
    maybeAddLocalUpload(archive, uploadDir, bgImageUrl, bgAssetName || 'background.png');

    await archive.finalize();
  } catch (err) {
    console.error('ZIP error:', err);
    res.status(500).json({ error: err.message || 'Failed to create ZIP' });
  }
});

// ✅ listen di 0.0.0.0 (wajib di Render)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend running on http://0.0.0.0:${PORT}`);
});
