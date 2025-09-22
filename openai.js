import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// kamu bisa ganti sesuai preferensi
const MODEL = process.env.MODEL || 'gpt-4.1-mini';

export async function generateIndexHtml({
  name,
  ticker,
  description,
  logoUrl,
  backgroundUrl,
  theme = 'dark',
  accent = '#7c3aed',
  layout = 'hero',
  bgColor = '#0b0b0b',
}) {
  const system = [
    'You are an expert landing-page designer & front-end engineer.',
    'Return a COMPLETE, VALID **single-file** index.html.',
    'Inline all CSS & JS (no external requests).',
    'Use semantic HTML, A11y, responsive design.',
    'Use CSS variables; default system fonts.',
    'Respect `theme` (dark/light) and `accent` color.',
    'Do not include analytics/external scripts/iframes/webfonts.',
    'If placeholders exist <!--OBRIX_LOGO_HERE-->, put the logo <img> there.',
    'If not, still render a hero section that looks great even without assets.',
  ].join('\n');

  const user = `
Project: ${name}
Ticker: ${ticker}
Theme: ${theme}
Accent: ${accent}
Background Color: ${bgColor}
Layout Preference: ${layout}
Provided Logo URL (may be data URI or regular URL): ${logoUrl || 'N/A'}
Provided Background URL (may be data URI or regular URL): ${backgroundUrl || 'N/A'}

Description:
${description}

Hard Requirements:
- Single file HTML.
- Sections: Hero, About, Token Highlight, Features, Small Roadmap, CTA, Footer.
- Add "Copy Ticker" button that copies ${ticker} to clipboard.
- Add "Back to top" floating button.
- Use CSS variables; minimal JS at end for copy/scroll.
- Include meta tags (title, description, og: tags) and base64 favicon.
- Add a comment placeholder <!--OBRIX_LOGO_HERE--> inside the hero header area.
`;

  // Chat Completions (akan tetap mungkin mengeluarkan fences; kita strip di server)
  const resp = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.7,
  });

  const html = resp.choices?.[0]?.message?.content || '';
  if (!html || !String(html).toLowerCase().includes('<html')) {
    throw new Error('Model did not return a valid index.html');
  }
  return html;
}
