const STYLE = `
:root {
  --bg: #f6f4ef;
  --ink: #1b1a17;
  --muted: #6d6a62;
  --line: #e3dfd5;
  --accent: #1f6f4a;
  --accent-soft: #e4efe8;
  --panel: #fbfaf7;
}
:root[data-state="error"] {
  --accent: #a3361f;
  --accent-soft: #f5e3dd;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #12110f;
    --ink: #ece8df;
    --muted: #9b968b;
    --line: #2a2824;
    --accent: #7cc49d;
    --accent-soft: #1c2a22;
    --panel: #191815;
  }
  :root[data-state="error"] {
    --accent: #e48a73;
    --accent-soft: #2e1d18;
  }
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 16px/1.55 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  display: grid;
  place-items: center;
  padding: 24px;
}
main { width: 100%; max-width: 440px; }
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 56px;
}
.brand i { width: 18px; height: 1px; background: var(--line); display: block; }
.mark { width: 56px; height: 56px; margin-bottom: 28px; }
.mark circle { fill: var(--accent-soft); }
.mark path {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 40;
  stroke-dashoffset: 40;
  animation: draw .5s .15s cubic-bezier(.65, 0, .35, 1) forwards;
}
@keyframes draw { to { stroke-dashoffset: 0; } }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } }
.mark, h1, p, .next, pre { animation: rise .5s cubic-bezier(.2, .7, .2, 1) both; }
h1 { animation-delay: .05s; }
p { animation-delay: .1s; }
.next, pre { animation-delay: .15s; }
h1 {
  font-family: ui-serif, "Iowan Old Style", "Palatino Linotype", Georgia, serif;
  font-weight: 500;
  font-size: 40px;
  line-height: 1.1;
  letter-spacing: -.02em;
  margin: 0 0 14px;
}
p { margin: 0; color: var(--muted); font-size: 17px; }
.next {
  margin-top: 40px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
  font-size: 14px;
  color: var(--muted);
}
.next b { color: var(--ink); font-weight: 500; }
pre {
  margin: 32px 0 0;
  padding: 16px 18px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  font: 13px/1.6 ui-monospace, "Cascadia Mono", Consolas, monospace;
  color: var(--ink);
  white-space: pre-wrap;
  word-break: break-word;
}
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; }
  .mark path { stroke-dashoffset: 0; }
}
`;

const ICON = {
  success: 'M19 28.5l6 6 12-13',
  error: 'M21.5 21.5l13 13M34.5 21.5l-13 13',
};

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

export class ResultPage {
  static render(success: boolean, detail?: string): string {
    const title = success ? 'You are connected.' : 'Sign-in did not finish.';
    const lead = success
      ? 'SongNgan can now read your Google Classroom. You can close this tab.'
      : 'Google did not complete the sign-in. Nothing was saved.';
    const next = success
      ? 'Go back to your AI and ask <b>What is due this week?</b>'
      : 'Run <b>npm run setup</b> again, and allow every permission Google asks for.';
    return [
      '<!doctype html>',
      `<html lang="en" data-state="${success ? 'success' : 'error'}">`,
      '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
      `<title>SongNgan - ${success ? 'Connected' : 'Sign-in failed'}</title><style>${STYLE}</style></head>`,
      '<body><main>',
      '<div class="brand">SongNgan<i></i>Google Classroom</div>',
      `<svg class="mark" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="28"/><path d="${success ? ICON.success : ICON.error}"/></svg>`,
      `<h1>${title}</h1>`,
      `<p>${lead}</p>`,
      detail ? `<pre>${escape(detail)}</pre>` : '',
      `<div class="next">${next}</div>`,
      '</main></body></html>',
    ].join('');
  }
}
