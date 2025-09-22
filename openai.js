// openai.js
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.MODEL || 'gpt-4.1-mini';

/**
 * Hasilkan satu file index.html yang modern & “rasa manusia”.
 * Kita tetap inject logo/bg dari backend, tapi prompt ini membantu model
 * menghasilkan struktur & estetika yang bagus.
 */
export async function generateIndexHtml({
  name,
  ticker,
  description,
  logoUrl = '',
  backgroundUrl = '',
  theme = 'dark',
  accent = '#7c3aed',
  layout = 'hero',
  bgColor = '#0b0b0b',
}) {
  const system = [
    'You are a senior front-end designer & developer.',
    'Return a COMPLETE, VALID single-file index.html.',
    'Inline all CSS & JS (no external requests).',
    'Use semantic HTML5, accessibility (landmarks, alt, aria-label), and responsive design.',
    'Use CSS variables; system UI font stack; tasteful shadows and spacing.',
    'Respect `theme` (dark/light) and `accent` color.',
    'Do NOT include analytics, external scripts, iframes, or webfonts.',
    'If <!--OBRIX_LOGO_HERE--> placeholder exists, place the logo <img> there.',
    'Always include sections: Hero, About/Story, Token/Ticker highlight, Features/Utilities, Roadmap (concise), Social/CTA buttons.',
    'Add a "Copy Ticker" button and a back-to-top button with smooth scroll.',
    'Add meaningful <title>, meta description, and Open Graph tags.',
    'Provide a tiny base64 favicon in <head>.',
    'Prefer a classy, minimal, modern look with subtle animations.',
  ].join('\n');

  const user = `
Project Name: ${name}
Ticker: ${ticker}
Theme: ${theme}
Accent: ${accent}
Preferred Layout: ${layout}
Logo URL (hint for you, may be replaced later): ${logoUrl || 'N/A'}
Background URL (hint for you, may be replaced later): ${backgroundUrl || 'N/A'}
Background Color: ${bgColor}

Description:
${description}

Strict Requirements:
- ONE FILE ONLY (index.html) with inline CSS/JS.
- Define CSS variables: --accent for ${accent}.
- Use <main> container with max-width ~1000px and generous spacing.
- Include <!--OBRIX_LOGO_HERE--> comment in the hero where a logo would go (even if none).
- If you style background, do it on body with a gradient using --accent and ${bgColor}; do not rely on external assets.
- Avoid huge opaque overlays that could hide body background.
- Never output Markdown code fences. Output pure HTML.
`;

  // gunakan Chat Completions (stabil di banyak env)
  const resp = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.7,
  });

  let html = resp.choices?.[0]?.message?.content || '';
  // kebetulan, ada model yang masih memberi ```html ... ``` — backend akan strip lagi,
  // tapi kita rapikan di sini sekalian:
  html = html.replace(/```html|```/g, '').trim();

  if (!html || !/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) {
    throw new Error('Model did not return a valid index.html');
  }
  return html;
}
