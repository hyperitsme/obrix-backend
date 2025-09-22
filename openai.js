import OpenAI from "openai";

/* ===== Quality gates ===== */
const BANNED_HEADINGS = [/^\s*fast\s*$/i, /^\s*customizable\s*$/i, /^\s*reliable\s*$/i];

function violatesExternal(html) {
  return /(https?:)?\/\/(fonts\.|cdnjs|unpkg|cdn\.|googleapis|gstatic|jsdelivr|bootstrap|tailwindcss)/i.test(html)
      || /\b<link\b[^>]*rel=["']stylesheet/i.test(html)
      || /\b<script\b[^>]*src=/i.test(html)
      || /\b@import\b/i.test(html)
      || /\b<iframe\b/i.test(html);
}
function hasBannedHeadings(html) {
  const matches = [...html.matchAll(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gis)];
  return matches.some(m => {
    const text = (m[1] || "").replace(/<[^>]+>/g, "").trim();
    return BANNED_HEADINGS.some(rx => rx.test(text));
  });
}
function isValidHTML(html) { return typeof html === "string" && /^<!doctype html>/i.test(html.trim()); }

/* ===== Prompts ===== */
function systemMsg() {
  return [
    "You are a professional web studio (brand copywriter + senior front-end engineer).",
    "Return ONLY a COMPLETE, VALID single-file index.html.",
    "Inline ALL CSS & JS. Absolutely NO external requests (fonts/scripts/iframes/CDNs).",
    "Semantic HTML, a11y roles, focus-visible, mobile-first responsive.",
    "Use CSS variables in :root for colors (primary, accent) and the system-ui font stack.",
    "Design language: colorful, tasteful animations (keyframes), playful pill buttons, hover lifts, soft shadows, glass/blur accents.",
    "Copywriting MUST be specific to the given project description.",
    "Never use generic section titles like “Fast”, “Customizable”, or “Reliable”.",
    "Do NOT mention prompts, models, or how it was generated."
  ].join(" ");
}

function primaryPrompt(brief) {
  const { name, ticker, description, telegram, twitter, primaryColor, accentColor } = brief;

  return `
Build a polished landing page.

PROJECT
- Name: ${name}
- Ticker: ${ticker || ""}
- Description: ${description}
- Telegram: ${telegram || ""}
- X/Twitter: ${twitter || ""}

THEME
- :root { --primary: ${primaryColor}; --accent: ${accentColor}; }
- Dark background, high contrast, vibrant accents.

ASSETS (IMPORTANT)
- Insert these markers exactly and use them in the HTML:
  - LOGO: "%%LOGO_DATA_URL%%"
  - BACKGROUND: "%%BG_DATA_URL%%"
  Example usage:
    <img src="%%LOGO_DATA_URL%%" alt="project logo" class="logo">
    .hero{ background-image: url(%%BG_DATA_URL%%); }  // add overlay for readability
  If an asset is unavailable, still keep the element but it may be empty; the backend will replace or remove it.

STRUCTURE
- Sticky header with logo (using the marker), simple nav (About, Token & Utility, Roadmap, FAQ), and a playful primary CTA.
- Hero with big headline tied to the description, subheadline, CTAs, and background using the marker.
- 4–6 uniquely named features aligned with the description (NOT generic).
- Optional: short About / Token&Utility / Roadmap / FAQ.
- Social buttons for Telegram and X.
- Footer with © YEAR and simple links.

TECH
- Put ALL styles in a single <style> and ALL scripts in a single <script>.
- Use only system fonts; no external links.
- Start with <!doctype html>.
- Output ONLY the final HTML (no fences/no commentary).`;
}

function revisionPrompt(reason) {
  return `
REVISION:
Previous HTML failed because: ${reason}
Please return ONLY a COMPLETE, VALID single-file index.html that fixes the issue.
Keep animations, playful buttons, colorful style, and project-specific copy.
Respect the asset markers %%LOGO_DATA_URL%% and %%BG_DATA_URL%%.
No external resources. Start with <!doctype html>.`;
}

/* ===== Generator ===== */
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
    primaryColor: payload.colors?.primary || "#7c3aed",
    accentColor: payload.colors?.accent || "#06b6d4",
    // NOTE: we DO NOT send the long base64 strings to the model to avoid token bloat.
    // We will inject them after generation via placeholders.
    logoDataUrl: payload.assets?.logo || "",
    backgroundDataUrl: payload.assets?.background || ""
  };

  let attempts = 0;
  let html = "";
  let lastReason = "";

  // 1) Ask the model to generate HTML with placeholders
  while (attempts <= maxRetries) {
    attempts++;
    const input = [
      { role: "system", content: systemMsg() },
      { role: "user", content: JSON.stringify({ ...brief, logoDataUrl: "%%LOGO_DATA_URL%%", backgroundDataUrl: "%%BG_DATA_URL%%" }) },
      { role: "user", content: attempts === 1 ? primaryPrompt(brief) : revisionPrompt(lastReason) }
    ];
    const res = await client.responses.create({
      model,
      temperature: 0.95,
      max_output_tokens: 7000,
      input
    });

    html = (res.output_text || "").trim();
    if (!isValidHTML(html)) { lastReason = "HTML must start with <!doctype html>."; continue; }
    if (violatesExternal(html)) { lastReason = "Contains external resources (fonts/scripts/iframes/CDNs)."; continue; }
    if (hasBannedHeadings(html)) { lastReason = "Uses generic headings (Fast/Customizable/Reliable)."; continue; }
    // Must include placeholders at least once (so we can inject)
    if (!html.includes("%%LOGO_DATA_URL%%") && !html.includes("%%BG_DATA_URL%%")) {
      lastReason = "Missing asset placeholders %%LOGO_DATA_URL%% / %%BG_DATA_URL%%.";
      continue;
    }
    break; // passed gates
  }

  if (!isValidHTML(html)) {
    throw new Error(`AI generation failed after retries: ${lastReason || "invalid HTML"}`);
  }

  // 2) Inject actual data URLs into placeholders (or remove safely if empty)
  const inject = (h) => {
    // Replace LOGO
    if (brief.logoDataUrl) {
      h = h.replaceAll("%%LOGO_DATA_URL%%", brief.logoDataUrl);
    } else {
      // remove empty src attributes cleanly
      h = h.replaceAll("%%LOGO_DATA_URL%%", "");
    }
    // Replace BG
    if (brief.backgroundDataUrl) {
      h = h.replaceAll("%%BG_DATA_URL%%", brief.backgroundDataUrl);
    } else {
      // default gradient if none
      h = h.replaceAll("%%BG_DATA_URL%%", "none");
    }
    return h;
  };

  html = inject(html);

  // quick re-check: no external; still valid
  if (!isValidHTML(html) || violatesExternal(html)) {
    throw new Error("Injection produced invalid HTML (unexpected).");
  }

  return html;
}
