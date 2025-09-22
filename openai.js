// openai.js
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// contoh default model; bisa ganti di Render ENV: MODEL
const MODEL = process.env.MODEL || 'gpt-4.1-mini';

export async function generateIndexHtml({
  name,
  ticker,
  description,
  logoUrl,        // boleh kosong
  backgroundUrl,  // boleh kosong
  theme = 'dark',
  accent = '#7c3aed',
  layout = 'hero',
  bgColor = '#0b0b0b',
}) {
  const system = [
    'You are an expert landing-page designer & front-end engineer.',
    'Return a COMPLETE, VALID, SINGLE-FILE index.html.',
    'Inline ALL CSS and JS (no external network requests).',
    'Use semantic HTML, accessible ARIA, responsive design.',
    'Use CSS variables for theming (e.g., --accent, --bg).',
    'If a logo URL is provided, include it via <img> with proper alt.',
    'If a background image URL is provided, use it as a hero/section background with CSS background-image.',
    'Otherwise, respect bgColor for body background.',
    'Include sections: Hero, About/Story, Token/Ticker highlight, Features/Utilities, Roadmap (minimal), Social/CTA placeholders.',
    'Include a "Copy Ticker" button and a floating "Back to top" button.',
    'Include sensible meta tags (title, description, og: tags).',
    'No analytics, no external scripts, no iframes, no remote fonts/icons.',
  ].join('\n');

  const user = `
Project Name: ${name}
Ticker: ${ticker}
Theme: ${theme}
Accent: ${accent}
Layout: ${layout}
Logo URL: ${logoUrl || 'N/A'}
Background Image URL: ${backgroundUrl || 'N/A'}
Background Color (fallback): ${bgColor}

Description (marketing tone):
${description}

Strict Requirements:
- Single HTML file only.
- Put minimal CSS in <style> and minimal JS in <script> at the end (copy ticker, smooth scroll, optional theme toggle).
- Prefer CSS variables: --accent for accent color and --bg for background color.
- If Background Image URL is provided, use it (with overlay if needed); otherwise use the provided bgColor.
- Ensure images use the URL passed AS-IS (do NOT strip leading slashes), e.g. "/uploads/xxxx.png" should remain that string in the HTML.
`;

  // gunakan Responses API (atau Chat Completions—bebas; ini pakai Responses)
  const resp = await client.responses.create({
    model: MODEL,
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const html =
    resp.output_text ||
    resp?.output?.[0]?.content?.find((p) => p.type === 'output_text')?.text ||
    resp?.output?.[0]?.content?.find((p) => p.type === 'text')?.text;

  if (!html || !String(html).toLowerCase().includes('<html')) {
    throw new Error('Model did not return a valid index.html');
  }
  return html;
}
