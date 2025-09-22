// index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import { customAlphabet } from "nanoid";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateSiteHTML, fallbackHTML } from "./openai.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

// Middleware
app.use(cors({ origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN, credentials: false }));
app.use(express.json({ limit: "20mb" })); // allow data-URL images
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// Static serving for generated sites
const SITES_DIR = path.join(__dirname, "sites");
fs.mkdirSync(SITES_DIR, { recursive: true });
app.use("/sites", express.static(SITES_DIR, { extensions: ["html"] }));

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

// Generate endpoint
app.post("/generate-site", async (req, res) => {
  const nano = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 10);
  const id = `site_${nano()}`;

  // Basic payload validation
  const {
    name,
    ticker,
    description,
    telegram,
    twitter,
    colors,
    assets
  } = req.body || {};

  if (!name && !description) {
    return res.status(400).json({ error: "Missing required fields (name or description)." });
  }

  let html = "";
  try {
    console.time("generateSiteHTML");
    html = await generateSiteHTML({ name, ticker, description, telegram, twitter, colors, assets });
    console.timeEnd("generateSiteHTML");
  } catch (err) {
    console.error("Generation failed, using fallback:", err.message);
    html = fallbackHTML({ name, ticker, description, telegram, twitter, colors, assets });
  }

  // Persist to ./sites/<id>/index.html
  const sitePath = path.join(SITES_DIR, id);
  fs.mkdirSync(sitePath, { recursive: true });
  fs.writeFileSync(path.join(sitePath, "index.html"), html, "utf8");

  const url = `${BASE_URL.replace(/\/+$/, "")}/sites/${id}/`;
  return res.json({ id, url, html });
});

// Root
app.get("/", (_req, res) => {
  res.type("text").send("Obrix Labs Generator API is running. POST /generate-site");
});

// Start
app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
  console.log(`Health: ${BASE_URL}/health`);
  console.log(`Sites:  ${BASE_URL}/sites/<id>/`);
});
