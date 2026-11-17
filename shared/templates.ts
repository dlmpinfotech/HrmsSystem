const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Replaces {{variable}} placeholders. Unknown variables render as an empty string. */
export function renderTemplate(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template
    .replace(VAR_RE, (_, key: string) => {
      const value = vars[key];
      return value === null || value === undefined ? '' : String(value);
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractVariables(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(VAR_RE)) found.add(match[1]);
  return [...found];
}

/** Variables used by the template that were not supplied. */
export function missingVariables(template: string, vars: Record<string, unknown>): string[] {
  return extractVariables(template).filter((v) => vars[v] === undefined || vars[v] === null || vars[v] === '');
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain-text body → minimal, safe HTML email (links become anchors). */
export function textToHtml(text: string, brand: string): string {
  const body = escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#4f46e5">$1</a>')
    .replace(/\n/g, '<br />');
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f6fa;font-family:Arial,'Noto Sans Tamil',sans-serif;color:#0f172a">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;line-height:1.6;font-size:15px">
<div style="font-weight:700;font-size:18px;margin-bottom:16px;color:#4f46e5">${escapeHtml(brand)}</div>
${body}
</div></body></html>`;
}
