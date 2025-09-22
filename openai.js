import OpenAI from "openai";

/**
 * Kriteria kualitas yang HARUS dipenuhi:
 * - Satu file HTML valid (diawali <!doctype html>)
 * - Tidak ada external request (fonts, scripts, iframes, CDN)
 * - Tidak ada heading generik: Fast / Customizable / Reliable (case-insensitive)
 * - Copywriting relevan dengan brief (name, ticker, description)
 * - Desain profesional: animasi halus (keyframes), hover, tombol playful, warna kaya
 */
const BANNED_HEADINGS = [/^\s*fast\s*$/i, /^\s*customizable\s*$/i, /^\s*reliable\s*$/i];

function violatesExternal(html) {
  // blokir resource eksternal
  return /(https?:)?\/\/(fonts\.|cdnjs|unpkg|cdn\.|googleapis|gstatic|jsdelivr|bootstrap|tailwindcss)/i.test(html)
      || /\b<link\b[^>]*rel=["']stylesheet/i.test(html)
      || /\b<script\b[^>]*src=/i.test(html)
      || /\b@import\b/i.test(html)
      || /\b<iframe\b/i.test(html);
}

function hasBannedHeadings(html) {
  // cari <h1..h6> yang isinya adalah kata generik
  const matches = [...html.matchAll(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gis)];
  return matches.some(m => {
    const text = (m[1] || "").replace(/<[^>]+>/g, "").trim();
    return BANNED_HEADINGS.some(rx => rx.test(text));
  });
}

function isValidHTML(html) {
  return typeof html === "string" && /^<!doctype html>/i.test(html.trim());
}

function buildSystemMessage() {
  return [
    "You are a professional web studio (brand copywriter + senior front-end engineer).",
    "Return ONLY a COMPLETE, VALID single-file index.html as output.",
    "Inline ALL CSS & JS. Absolutely NO external requests (fonts/scripts/iframes/CDNs).",
    "Use semantic HTML, accessibile roles, focus-visible, and mobile-first responsive.",
    "Use CSS variables in :root for colors (primary, accent) and system-ui font stack.",
    "Design language: modern, colorful, tasteful micro-interactions:",
    "- animated gradient accents (keyframes), soft shadows, glass + blur",
    "- playful pill buttons with hover/press feedback",
    "- card hover lift, animated borders/underlines, subtle parallax in hero",
    "- high contrast, readable on dark background",
    "Copywriting MUST be specific to the provided project description.",
    "Strictly AVOID generic section titles such as “Fast”, “Customizable”, or “Reliable”.",
    "Do NOT mention prompts, models, or how it was generated anywhere in the HTML."
  ].join(" ");
}

function buildPrimaryPrompt(brief) {
  const {
    name,
    ticker,
    description,
    telegram,
    twitter,
    primaryColor,
    accentColor,
    logoDataUrl,
    backgroundDataUrl
  } = brief;

  return `
Create a polished landing page for the project below.

PROJECT BRIEF
- Name: ${name}
- Ticker: ${ticker || ""}
- Description: ${description}
- Telegram: ${telegram || ""}
- X/Twitter: ${twitter || ""}

VISUAL DIRECTION
- Color variables:
  --primary: ${primaryColor}
  --accent:  ${accentColor}
- If a background image is provided, layer it in the hero with an overlay for readability.
- If a logo is provided, use it in header/hero.

CONTENT & SECTIONS
- Sticky header with logo, minimal nav, and prominent CTA.
- Hero: a memorable headline that reflects the description, short subheadline, primary CTA.
- 4–6 features with unique, project-relevant names (no generic words like Fast/Customizable/Reliable).
- Optional: About / Token/Utility / Roadmap / FAQ (short, punchy).
- Social buttons for Telegram and X using the provided links.
- Footer with © YEAR and simple links.

TECH NOTES
- Put ALL styles in a single <style> and ALL scripts in a single <script>.
- Use only system font stack (no webfont links).
- Start the document with <!doctype html>.
- Output ONLY the final HTML (no markdown fences, no commentary).

DATA-URL ASSETS
- Logo: ${logoDataUrl ? "PROVIDED" : "NONE"}
- Background: ${backgroundDataUrl ? "PROVIDED" : "NONE"}
Use them if provided.
`;
}

function buildRevisionPrompt(reason) {
  return `
REVISION REQUEST:
The previous HTML failed a quality gate because: ${reason}.
Please rewrite and return ONLY a COMPLETE, VALID single-file index.html that fixes the issue.
Remember:
- No external resources (fonts/scripts/iframes/CDNs).
- Avoid generic section titles like "Fast", "Customizable", "Reliable".
- Keep animations, playful buttons, colorful style, and project-specific copy.
- Start with <!doctype html>.
`;
}

export async function generateSiteHTML(payload) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.MODEL || "gpt-4o-mini";
  const maxRetries = Number(process.env.MAX_RETRIES || 2);

  const brief = {
    name: payload.name || "Untitled Project",
    ticker: payload.ticker || "$TOKEN",
    description: payload.description || "A crypto project.",
    telegram: payload.telegram || "",
    twitter: payload.twitter || "",
    primaryColor: payload.colors?.primary || "#7c3aed", // purple vibes by default
    accentColor: payload.colors?.accent || "#06b6d4",  // cyan accent by default
    logoDataUrl: payload.assets?.logo || "",
    backgroundDataUrl: payload.assets?.background || ""
  };

  let attempts = 0;
  let html = "";
  let lastReason = "";

  while (attempts <= maxRetries) {
    attempts++;

    const input = [
      { role: "system", content: buildSystemMessage() },
      { role: "user", content: JSON.stringify(brief) },
      { role: "user", content: attempts === 1 ? buildPrimaryPrompt(brief)
                                              : buildRevisionPrompt(lastReason) }
    ];

    const res = await client.responses.create({
      model,
      temperature: 0.95,            // lebih kreatif
      max_output_tokens: 7000,      // ruang lebih besar untuk HTML lengkap
      input
    });

    html = (res.output_text || "").trim();

    // Quality gates
    if (!isValidHTML(html)) {
      lastReason = "Document is not a valid single-file HTML starting with <!doctype html>.";
      continue;
    }
    if (violatesExternal(html)) {
      lastReason = "It contains external resources (fonts/scripts/iframes/CDNs).";
      continue;
    }
    if (hasBannedHeadings(html)) {
      lastReason = "It uses generic section headings (Fast/Customizable/Reliable).";
      continue;
    }

    // Passed all checks
    return html;
  }

  // Jika tetap gagal setelah retry, lempar error agar API tidak memakai fallback generik
  throw new Error(`AI generation failed quality checks after ${maxRetries + 1} attempts: ${lastReason}`);
}
