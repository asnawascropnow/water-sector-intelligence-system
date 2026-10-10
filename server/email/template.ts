import { TEMPLATE_VARIABLES, type RenderedEmail } from "../../shared/email";

export type TemplateVars = Record<string, string | null | undefined>;

const VAR_RE = /\{\{\s*([a-z_]+\.[a-z_]+)\s*(?:\|([^}]*))?\}\}/gi;
/** Human-fill placeholders, e.g. [[Name of the project]]. A campaign cannot be approved while any remain. */
const PLACEHOLDER_RE = /\[\[([^\]]{1,200})\]\]/g;
const KNOWN = new Set<string>(TEMPLATE_VARIABLES.map((v) => v.key));

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function unknownVariables(template: string): string[] {
  return [...new Set([...template.matchAll(VAR_RE)].map((m) => m[1].toLowerCase()).filter((k) => !KNOWN.has(k)))];
}

export function findPlaceholders(...texts: (string | null | undefined)[]): string[] {
  return [...new Set(texts.flatMap((t) => [...(t ?? "").matchAll(PLACEHOLDER_RE)].map((m) => m[1].trim())))];
}

/** Substitute variables. Values are escaped when rendering HTML. Missing values with no fallback are reported. */
export function renderTemplate(template: string, vars: TemplateVars, opts: { html?: boolean } = {}): { out: string; missing: string[] } {
  const missing = new Set<string>();
  const out = template.replace(VAR_RE, (_m, key: string, fallback?: string) => {
    const v = vars[key.toLowerCase()];
    const value = v != null && String(v).trim() ? String(v).trim() : fallback !== undefined ? fallback.trim() : null;
    if (value === null) {
      missing.add(key.toLowerCase());
      return "";
    }
    return opts.html ? escapeHtml(value) : value;
  });
  return { out, missing: [...missing] };
}

/** Plain text → simple, safe HTML (paragraphs, line breaks, linked URLs). */
export function textToHtml(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/**
 * Defence-in-depth clean-up of user-authored HTML: strips active content. Previews are additionally shown
 * in a sandboxed iframe on the client.
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|link|meta|base|svg|math)\b[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi, "")
    .replace(/<\s*(script|iframe|object|embed|link|meta|base)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|action)\s*=\s*("|')?\s*(javascript|vbscript|data):[^"'\s>]*/gi, '$1=$2#');
}

export interface FooterInfo {
  senderName: string;
  company: string | null;
  address: string | null;
  unsubscribeUrl: string;
}

export function footerText(f: FooterInfo) {
  return [
    "--",
    [f.senderName, f.company].filter(Boolean).join(", "),
    f.address,
    "You are receiving this one-to-one business email because your organization appears in our water-sector research.",
    `To stop receiving these emails: ${f.unsubscribeUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function footerHtml(f: FooterInfo) {
  return `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px">
<p style="margin:0;color:#666;font-size:12px;line-height:1.5">${escapeHtml([f.senderName, f.company].filter(Boolean).join(", "))}${f.address ? `<br>${escapeHtml(f.address)}` : ""}<br>
You are receiving this one-to-one business email because your organization appears in our water-sector research.<br>
<a href="${escapeHtml(f.unsubscribeUrl)}" style="color:#666">Unsubscribe</a></p>`;
}

/** Render subject/text/html for one recipient, appending the mandatory sender + unsubscribe footer. */
export function renderEmail(
  content: { subject: string; text: string; html?: string | null },
  vars: TemplateVars,
  footer: FooterInfo,
): RenderedEmail {
  const subject = renderTemplate(content.subject, vars);
  const text = renderTemplate(content.text, vars);
  const htmlBody = content.html?.trim() ? sanitizeHtml(renderTemplate(content.html, vars, { html: true }).out) : textToHtml(text.out);
  const htmlMissing = content.html?.trim() ? renderTemplate(content.html, vars, { html: true }).missing : [];
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#222">${htmlBody}\n${footerHtml(footer)}</body></html>`;
  return {
    subject: subject.out.replace(/\s+/g, " ").trim(),
    text: `${text.out.trim()}\n\n${footerText(footer)}`,
    html,
    missing: [...new Set([...subject.missing, ...text.missing, ...htmlMissing])],
    placeholders: findPlaceholders(content.subject, content.text, content.html),
  };
}

export function firstName(name: string | null | undefined): string | null {
  if (!name) return null;
  const parts = name
    .replace(/^(mr|mrs|ms|miss|dr|prof|shri|smt)\.?\s+/i, "")
    .trim()
    .split(/\s+/);
  return parts[0] || null;
}
