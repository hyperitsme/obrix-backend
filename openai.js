// openai.js
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.MODEL || 'gpt-4.1-mini';

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
    'Use semantic HTML5, accessibility (landmarks, alt, aria-label), responsive design.',
    'Use CSS variables; system UI font stack; subtle shadows & animation.',
    'Respect `theme` (dark/light) and `accent` color.',
    'No analytics/external scripts/iframes/webfonts.',
    'If <!--OBRIX_LOGO_HERE--> exists, place the logo there.',
    'Include sections: Hero, About, Token/Ticker, Features, Roadmap, Social/CTA.',
    'Add "Copy Ticker" button + back-to-top (smooth scroll).',
    'Add <title>, meta description, Open Graph; tiny base64 favicon in <head>.',
    'Avoid big opaque overlays that hide the page background.',
  ].join('\n');

  const user = `
Project Name: ${name}
Ticker: ${ticker}
Theme: ${theme}
Accent: ${accent}
Preferred Layout: ${layout}
Logo URL (hint; may be replaced later): ${logoUrl || 'N/A'}
Background URL (hint; may be replaced later): ${backgroundUrl || 'N/A'}
Background Color: ${bgColor}

Description:
${description}

Strict:
- ONE FILE ONLY, pure HTML (no Markdown fences).
- Define CSS variable --accent with ${accent}.
- Include <!--OBRIX_LOGO_HERE--> in hero (even if logo missing).
- Body should look good even without background asset.
`;

  const resp = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.7,
  });

  let html = resp.choices?.[0]?.message?.content || '';
  html = html.replace(/```html|```/g, '').trim();
  if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) {
    throw new Error('Model did not return a valid index.html');
  }
  return html;
}
