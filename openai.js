// openai.js
import OpenAI from "openai";

/**
 * Generate a complete single-file index.html from user payload.
 * The model is instructed to:
 * - Return ONLY valid HTML (no markdown).
 * - Inline ALL CSS & JS (no external requests).
 * - Use provided assets/colors/socials.
 * - English copywriting, accessible, responsive.
 * - Do not mention how it was generated.
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

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const system = [
    "You are an expert landing-page designer & front-end engineer.",
    "Return a COMPLETE, VALID single-file index.html.",
    "Inline all CSS & JS (no external fonts/scripts/iframes).",
    "Use semantic HTML, A11y, responsive design.",
    "Use CSS variables; system fonts.",
    "Respect theme colors (primary/accent) provided.",
    "Use provided data URLs for the logo/background if present.",
    "Include hero, features, call-to-action, socials, and footer.",
    "Include tasteful hover states and micro-interactions.",
    "Keep the copy in English; concise and convincing.",
    "Do NOT mention anything about prompts, models, or how it was generated."
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
Build a polished, modern landing page for a crypto/web3 project.

REQUIREMENTS
- Title: ${name} ${ticker ? `(${ticker})` : ""}
- Short description: ${description}
- Primary color: ${user.primaryColor}, Accent color: ${user.accentColor}
- Logo data URL (if given): ${user.logoDataUrl ? "[PROVIDED]" : "[NONE]"}
- Background image data URL (if given): ${user.backgroundDataUrl ? "[PROVIDED]" : "[NONE]"}
- Social links:
  - Telegram: ${telegram || "N/A"}
  - X/Twitter: ${twitter || "N/A"}

STRUCTURE
- Sticky header with logo + nav + CTA
- Hero with background image (if provided), logo (if provided), headline, subhead, CTA buttons
- 3-6 feature cards (hover interactions)
- Optional sections: About / Roadmap / FAQs (short)
- Social buttons (Telegram, X)
- Footer with © and simple links

TECH SPECS
- Use a :root { --primary: ; --accent: ; } and system font stack
- Inline CSS/JS only. No external requests.
- Accessible, high-contrast, keyboard friendly
- Mobile-first responsive
- Include a small <script> for any minor interactions
- DO NOT output anything except the final HTML.
`;

  const model = process.env.MODEL || "gpt-4o-mini";

  // Use Responses API; robust extraction of the text output
  const res = await client.responses.create({
    model,
    input: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user) },
      { role: "user", content: prompt }
    ]
  });

  // Try the convenience field first; fallback to traversing output array
  let html = res.output_text;
  if (!html) {
    try {
      const parts = res.output?.[0]?.content || [];
      const textPart = parts.find(p => p.type === "output_text" || p.type === "text");
      html = textPart?.text || "";
    } catch {}
  }
  if (typeof html !== "string" || !html.trim().startsWith("<")) {
    throw new Error("Model did not return HTML.");
  }
  return html.trim();
}

/**
 * Minimal local fallback HTML (used if model call fails).
 */
export function fallbackHTML(p) {
  const {
    name = "Untitled Project",
    ticker = "$TOKEN",
    description = "Your project description.",
    telegram = "#",
    twitter = "#",
    colors = { primary: "#3b82f6", accent: "#2563eb" },
    assets = { logo: "", background: "" }
  } = p;

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
.hero{min-height:62vh;display:grid;place-items:center;text-align:center;padding:40px;
  background:${assets.background ? `url('${assets.background}') center/cover no-repeat` : `linear-gradient(135deg,var(--primary),var(--accent))`}}
.wrap{max-width:900px;margin:0 auto;padding:24px}
.logo{width:84px;height:84px;border-radius:20px;box-shadow:0 0 0 6px #ffffff22;margin:0 auto 16px;display:block}
.btn{display:inline-block;padding:12px 16px;border-radius:12px;border:1px solid #ffffff55;background:#00000033;color:#fff;text-decoration:none;margin:6px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(3,1fr)}@media(max-width:820px){.grid{grid-template-columns:1fr}}
.card{background:#ffffff10;border:1px solid #ffffff2a;border-radius:14px;padding:16px;transition:.2s}
.card:hover{transform:translateY(-4px);box-shadow:0 16px 40px -18px rgba(59,130,246,.35)}
footer{color:#aab3d0;text-align:center;padding:24px;border-top:1px solid #ffffff18}
</style>
</head>
<body>
<section class="hero">
  <div class="wrap">
    ${assets.logo ? `<img class="logo" alt="logo" src="${assets.logo}"/>` : ""}
    <h1>${name} <small>${ticker}</small></h1>
    <p>${description}</p>
    <p style="margin-top:16px">
      <a class="btn" href="${telegram||'#'}" target="_blank" rel="noopener">Join Telegram</a>
      <a class="btn" href="${twitter||'#'}" target="_blank" rel="noopener">Follow X</a>
    </p>
  </div>
</section>
<div class="wrap">
  <div class="grid">
    <div class="card"><h3>Fast</h3><p>Generate and publish your site quickly.</p></div>
    <div class="card"><h3>Customizable</h3><p>Tweak colors and copy to fit your brand.</p></div>
    <div class="card"><h3>Reliable</h3><p>Clean HTML, responsive, and accessible.</p></div>
  </div>
</div>
<footer>© ${new Date().getFullYear()} ${name}</footer>
</body>
</html>`;
}
