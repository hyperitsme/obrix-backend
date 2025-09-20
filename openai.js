import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MODEL = process.env.MODEL || 'gpt-4.1-mini';

export async function generateIndexHtml({ name, ticker, description, logoUrl, theme='dark', accent='#7c3aed', layout='hero' }) {
  const system = [
    'You are an expert landing-page designer & front-end engineer.',
    'Output a COMPLETE, VALID, SINGLE-FILE index.html.',
    'Inline all CSS and JS (no external network requests).',
    'Use semantic HTML, accessible ARIA, responsive design.',
    'Default font stack; include minimal Tailwind-like utility styles via inline <style>.',
    'Respect the provided theme (dark/light) and accent color.',
    'If a logo URL is provided, include it in an <img>; otherwise use a simple text logotype.',
    'Include subtle animations on hover and scroll.',
    'Ensure the page passes basic Lighthouse checks and is mobile-first.',
    'No analytics, no external scripts, no iframes, no remote fonts/icons.'
  ].join('\n');

  const user = `
Project Name: ${name}
Ticker: ${ticker}
Theme: ${theme}
Accent: ${accent}
Preferred Layout: ${layout}
Logo URL: ${logoUrl || 'N/A'}

Description (marketing tone, hero + features + token section + CTA):
${description}

Strict Requirements:
- Single file: everything in one index.html
- Include sections: Hero, About/Story, Token/Ticker highlight, Features/Utilities, Roadmap (minimal), Social/CTA buttons placeholders
- Include a "Copy Ticker" button that copies ${ticker} to clipboard
- Add a floating "Back to top" button
- Use CSS variables for accent color
- Add minimal JS at end of file for interactivity (copy ticker, smooth scroll, theme toggle if feasible)
- Provide meaningful meta tags (title, description, og: tags)
- Provide favicon as base64 data URL (tiny placeholder) within the HTML <head>
`;

  const response = await client.responses.create({
    model: MODEL,
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
  });

  const html = response.output_text || (
    response?.output?.[0]?.content?.find(p => p.type === 'output_text')?.text
  ) || (
    response?.output?.[0]?.content?.find(p => p.type === 'text')?.text
  );

  if (!html || !String(html).includes('<html')) {
    throw new Error('Model did not return a valid index.html');
  }
  return html;
}
