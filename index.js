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

// CORS
const originsEnv = process.env.CORS_ORIGINS || '*';
const corsOptions = originsEnv === '*' ? { origin: true } : {
  origin: function (origin, callback) {
    const allowed = originsEnv.split(',').map(s => s.trim());
    if (!origin || allowed.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const safe = Date.now() + '-' + (file.originalname || 'logo');
    cb(null, safe.replace(/[^a-zA-Z0-9._-]/g, '_'));
  }
});
const upload = multer({ storage });

// Health check
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'obrix-website-generator',
    time: new Date().toISOString()
  });
});

// Upload a logo file
app.post('/api/upload-logo', upload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filePath = `/uploads/${req.file.filename}`;
  res.json({ ok: true, path: filePath });
});

// Serve uploads statically
app.use('/uploads', express.static(uploadDir));

// Generate HTML via OpenAI
app.post('/api/generate', async (req, res) => {
  try {
    const { name, ticker, description, logoUrl, theme='dark', accent='#7c3aed', layout='hero' } = req.body || {};
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
    const { name, ticker, description, logoUrl, theme='dark', accent='#7c3aed', layout='hero' } = req.body || {};
    if (!name || !ticker || !description) {
      return res.status(400).json({ error: 'name, ticker, description are required' });
    }
    const html = await generateIndexHtml({ name, ticker, description, logoUrl, theme, accent, layout });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${(name||'site').replace(/[^a-z0-9_-]/gi,'_')}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => { throw err; });
    archive.pipe(res);

    archive.append(html, { name: 'index.html' });

    // If logoUrl is a local upload served from /uploads, include it
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

// ✅ FIX: listen di 0.0.0.0
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Backend running on http://0.0.0.0:${PORT}`);
});
