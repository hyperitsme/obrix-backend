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

app.use(cors({ origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN }));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// Serve generated sites
const SITES_DIR = path.join(__dirname, "sites");
fs.mkdirSync(SITES_DIR, { recursive: true });
app.use("/sites", express.static(SITES_DIR, { extensions: ["html"] }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/generate-site", async (req, res) => {
  const nano = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 10);
  const id = `site_${nano()}`;

  const payload = req.body || {};
  if (!payload?.name && !payload?.description) {
    return res.status(400).json({ error: "Missing required fields (name or description)." });
  }

  let html = "";
  let source = "ai";
  try {
    console.time("generateSiteHTML");
    html = await generateSiteHTML(payload);
    console.timeEnd("generateSiteHTML");
  } catch (err) {
    console.error("[AI] generation failed:", err.message);
    source = "fallback";
    html = fallbackHTML(payload);
  }

  // Persist
  const sitePath = path.join(SITES_DIR, id);
  fs.mkdirSync(sitePath, { recursive: true });
  fs.writeFileSync(path.join(sitePath, "index.html"), html, "utf8");

  const url = `${BASE_URL.replace(/\/+$/, "")}/sites/${id}/`;
  res.json({ id, url, html, source });
});

app.get("/", (_req, res) => {
  res.type("text").send("Obrix Labs Generator API is running. POST /generate-site");
});

app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
  console.log(`Health: ${BASE_URL}/health`);
  console.log(`Sites:  ${BASE_URL}/sites/<id>/`);
});
