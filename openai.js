import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.MODEL || "gpt-4o-mini";

/**
 * Menghasilkan single-file index.html
 * @param {{
 *  name: string,
 *  ticker: string,
 *  description: string,
 *  logoUrl?: string,
 *  theme?: 'dark'|'light',
 *  accent?: string,
 *  layout?: 'hero'|'split'|'centered',
 *  bgColor?: string,
 *  bgImageUrl?: string
 * }} args
 */
export async function generateIndexHtml({
  name,
  ticker,
  description,
  logoUrl,
  theme = "dark",
  accent = "#7c3aed",
  layout = "hero",
  bgColor = "",
  bgImageUrl = ""
}) {
  const system = [
    "You are an expert landing-page designer & front-end engineer.",
    "Output a COMPLETE, VALID, SINGLE-FILE index.html.",
    "Inline all CSS and JS (no external network requests).",
    "Use semantic HTML, accessible ARIA, responsive design.",
    "Respect the provided theme and accent color.",
    "If a Logo URL is provided, you MUST render it exactly with <img src=\"{that-url}\" alt=\"...\"> (do not change the URL).",
    "If a Background Image URL is provided, you MUST set it on <body> with background-image:url('{that-url}'); cover/center/fixed (do not change the URL).",
    "Do not transform, proxy, or re-host any provided URLs.",
    "No external scripts/fonts/icons."
  ].join("\n");

  const user = `
Project Name: ${name}
Ticker: ${ticker}
Theme: ${theme}
Accent: ${accent}
Layout: ${layout}

Logo URL (use exactly as provided): ${logoUrl || "N/A"}
Background Color (optional): ${bgColor || "N/A"}
Background Image URL (use exactly as provided): ${bgImageUrl || "N/A"}

Description (hero + features + token section + CTA):
${description}

Strict Requirements:
- Single file only (all CSS & JS inline).
- Sections: Hero, About/Story, Token/Ticker highlight, Features/Utilities, Roadmap (minimal), Social/CTA placeholders.
- "Copy Ticker" button that copies ${ticker} to clipboard.
- Floating "Back to top" button.
- Use CSS variables for accent.
- Minimal JS at end (copy ticker, smooth scroll, optional theme toggle).
- Proper meta tags (title, description, og:*).
- Favicon as base64 in <head>.
`;

  const resp = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  });

  let html = resp?.choices?.[0]?.message?.content || "";

  // ---------- Guardrail: paksa logo & background muncul bila model “lupa” ----------
  // Logo <img src="...">
  if (logoUrl && !html.includes(logoUrl)) {
    // coba selipkan di <header> jika ada
    const injectedImg = `<img src="${logoUrl}" alt="${(name || "logo")}" style="max-height:64px;object-fit:contain">`;
    if (/<header[^>]*>/i.test(html)) {
      html = html.replace(/<header[^>]*>/i, (m) => `${m}\n${injectedImg}`);
    } else if (/<body[^>]*>/i.test(html)) {
      // atau buat header sederhana setelah <body>
      html = html.replace(/<body([^>]*)>/i, (m, pre) => `<body${pre}>\n<header style="padding:16px 24px">${injectedImg}</header>`);
    }
  }

  // Background pada <body style="...">
  if (bgColor || bgImageUrl) {
    const parts = [];
    if (bgColor) parts.push(`background-color:${bgColor}`);
    if (bgImageUrl) {
      parts.push(
        `background-image:url('${bgImageUrl}')`,
        `background-size:cover`,
        `background-position:center`,
        `background-attachment:fixed`
      );
    }

    if (parts.length) {
      if (/<body[^>]*style=/i.test(html)) {
        // tambahkan ke style yang sudah ada
        html = html.replace(
          /<body([^>]*)style="([^"]*)"/i,
          (m, pre, s) => `<body${pre}style="${s}; ${parts.join("; ")}"`
        );
      } else if (/<body[^>]*>/i.test(html)) {
        // atau buat style baru pada body
        html = html.replace(
          /<body([^>]*)>/i,
          (m, pre) => `<body${pre} style="${parts.join("; ")}">`
        );
      }
    }
  }
  // -------------------------------------------------------------------------------

  if (!html || !String(html).toLowerCase().includes("<html")) {
    throw new Error("Model did not return a valid index.html");
  }

  return html;
}
