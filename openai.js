// openai.js
import OpenAI from "openai";

/**
 * Minta model mengembalikan 1 file HTML utuh:
 * - Inline CSS & JS
 * - Aksesibilitas & responsive
 * - Menggunakan primary/accent colors
 * - Memakai logo/background (data URL) jika ada
 * - Copywriting harus relevan dg project (no boilerplate)
 * - Jangan menyebut model/prompt di output
 */
export async function generateSiteHTML(payload) {
  const {
    name,
    ticker,
    description,
    telegram,
    twitter,
    colors,
    assets
  } = payload;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.MODEL || "gpt-4o-mini";

  const system = [
    "You are a senior brand copywriter and front-end engineer.",
    "Return ONLY a COMPLETE, VALID single-file index.html.",
    "Inline all CSS & JS. No external requests (fonts, scripts, iframes).",
    "Use semantic HTML, accessible roles, keyboard focus styles.",
    "Mobile-first responsive layout.",
    "Use :root CSS variables for colors (primary, accent) and system font.",
    "Use provided data URLs for logo and background if present.",
    "Provide distinctive, project-specific copy tied to the given description.",
    "Avoid generic feature names like 'Fast', 'Customizable', 'Reliable'.",
    "Do NOT mention prompts, models, or how it was generated."
  ].join(" ");

  const user = {
    name,
    ticker,
    description,
    telegram,
    twitter,
    primaryColor: colors?.primary || "#3b82f6",
    accentColor: colors?.accent || "#2563eb",
    logoDataUrl: assets?.logo || "",
    backgroundDataUrl: assets?.background || ""
  };

  const prompt = `
Build a polished landing page for the project below.

PROJECT
- Name: ${name}
- Ticker: ${ticker || ""}
- Description: ${description}
- Telegram: ${telegram || ""}
- X/Twitter: ${twitter || ""}

DESIGN
- Colors: primary=${user.primaryColor}, accent=${user.accentColor}
- If background image provided, layer it in hero with readable overlay.
- If logo provided, display in header and/or hero.
- Sticky header with CTA. Soft card hover interactions.

CONTENT
- Headline that reflects the project's essence (do NOT use "Fast/Customizable/Reliable").
- Subheadline tied to the description.
- 4–6 feature cards with unique names tied to the description (e.g., "Community-led Liquidity", "Audited Contracts", "Cross-chain Routing", etc. — adjust to the given description).
- Optional: short About / Roadmap / FAQ.
- Prominent CTA(s). Social buttons for Telegram and X.
- Footer with © YEAR and simple links.

TECH SPECS
- Put all styles in a single <style> tag and scripts in a single <script>.
- Use :root { --primary: ; --accent: ; } and system-ui font stack.
- Add focus-visible outlines and sufficient contrast.
- Return ONLY the HTML (no markdown fences, no commentary).
- The document MUST start with <!doctype html>.
`;

  const res = await client.responses.create({
    model,
    temperature: 0.8,
    max_output_tokens: 6000,
    input: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user) },
      { role: "user", content: prompt }
    ]
  });

  let html = res.output_text?.trim?.() || "";
  if (!html || !/^<!doctype html>/i.test(html)) {
    // Try to extract text from segments if convenience field missing
    const parts = res.output?.[0]?.content || [];
    const textPart = parts.find(p => p.type === "output_text" || p.type === "text");
    html = textPart?.text?.trim?.() || "";
  }

  if (!/^<!doctype html>/i.test(html)) {
    throw new Error("Generator did not return a valid HTML document.");
  }
  return html;
}

/**
 * Fallback HTML yang lebih kontekstual, tanpa frase generik.
 */
export function fallbackHTML(p) {
  const {
    name = "Untitled Project",
    ticker = "$TOKEN",
    description = "A new crypto project.",
    telegram = "#",
    twitter = "#",
    colors = { primary: "#3b82f6", accent: "#2563eb" },
    assets = { logo: "", background: "" }
  } = p;

  const features = [
    { title: "Project Mission", body: description.slice(0, 180) + (description.length > 180 ? "..." : "") },
    { title: "Community Hub", body: "Join our community for updates, governance talks, and launch plans." },
    { title: "Launch & Utility", body: "A focused roadmap that turns the idea into daily utility." },
    { title: "Trust & Transparency", body: "Clear docs, visible roadmap, and public socials you can verify." },
    { title: "Brand & Identity", body: "Strong visuals, consistent tone, and shareable assets." }
  ];

  const featCards = features.map(f =>
    `<div class="card"><h3>${f.title}</h3><p>${f.body}</p></div>`
  ).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${name} ${ticker}</title>
<style>
:root{--primary:${colors.primary};--accent:${colors.accent}}
*{box-sizing:border-box}html,body{margin:0}
body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial;color:#e8ebf5;background:#0b0f1a}
a{color:inherit;text-decoration:none}
.header{position:sticky;top:0;background:#0b0f1acc;border-bottom:1px solid #ffffff22;backdrop-filter:blur(8px);z-index:50}
.wrap{max-width:980px;margin:0 auto;padding:18px}
.hero{min-height:62vh;display:grid;place-items:center;text-align:center;padding:42px;
  background:${assets.background ? `url('${assets.background}') center/cover no-repeat` : `linear-gradient(135deg,var(--primary),var(--accent))`}}
.logo{width:84px;height:84px;border-radius:20px;box-shadow:0 0 0 6px #ffffff22;margin:0 auto 16px;display:block}
.cta{display:inline-block;padding:12px 16px;border-radius:12px;border:1px solid #ffffff55;background:#00000033}
.grid{display:grid;gap:16px;grid-template-columns:repeat(3,1fr)}@media(max-width:820px){.grid{grid-template-columns:1fr}}
.card{background:#ffffff10;border:1px solid #ffffff2a;border-radius:14px;padding:16px;transition:.2s}
.card:hover{transform:translateY(-4px);box-shadow:0 16px 40px -18px rgba(59,130,246,.35)}
footer{color:#aab3d0;text-align:center;padding:24px;border-top:1px solid #ffffff18}
</style>
</head>
<body>
<header class="header"><div class="wrap" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
  <div style="display:flex;align-items:center;gap:10px">
    ${assets.logo ? `<img class="logo" src="${assets.logo}" alt="logo" style="width:32px;height:32px;margin:0;box-shadow:none"/>` : ""}
    <strong>${name}</strong><span style="opacity:.7">${ticker}</span>
  </div>
  <div style="display:flex;gap:10px"><a class="cta" href="${telegram||'#'}" target="_blank" rel="noopener">Telegram</a><a class="cta" href="${twitter||'#'}" target="_blank" rel="noopener">X</a></div>
</div></header>

<section class="hero">
  <div class="wrap">
    ${assets.logo ? `<img class="logo" alt="logo" src="${assets.logo}"/>` : ""}
    <h1>${name} <small>${ticker}</small></h1>
    <p>${description}</p>
    <p style="margin-top:16px"><a class="cta" href="${telegram||'#'}" target="_blank" rel="noopener">Join Telegram</a>
    <a class="cta" href="${twitter||'#'}" target="_blank" rel="noopener">Follow X</a></p>
  </div>
</section>

<div class="wrap" style="margin-top:24px">
  <div class="grid">${featCards}</div>
</div>

<footer>© ${new Date().getFullYear()} ${name}</footer>
</body>
</html>`;
}
