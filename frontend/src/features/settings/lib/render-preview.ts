/**
 * Client-side twin of `backend/app/email/renderer.py::_layout`.
 *
 * WHY THIS EXISTS: `previewEmailTemplate` renders the *saved* template. The whole
 * point of a split-pane editor is to see the email you are typing RIGHT NOW, so
 * the live pane has to render unsaved values, which means rendering them here.
 * The shell below is a faithful port — same 600px table, same colours, same brand
 * bar — so what the owner sees is what the backend will send. When the backend's
 * layout changes, this file changes with it; the alternative (a preview that
 * looks nothing like the email) is worse than no preview.
 *
 * The output is fed to <iframe srcDoc>. That is not a nicety: an email's CSS is a
 * pile of `body { margin:0 !important }` rules, and injecting it into the app's
 * DOM would wreck the app's own layout. The iframe is a hard boundary.
 */

const PAGE_BG = "#f1f3f6";
const CARD_BG = "#ffffff";
const TEXT = "#1f2937";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";
const FALLBACK_BRAND = "#4f46e5";

export interface PreviewTemplate {
  subject: string;
  bodyHtml: string;
  footerHtml: string;
  signature: string;
  primaryColor: string;
  accentColor: string;
  showLogo: boolean;
}

export interface PreviewBusiness {
  name: string;
  logoUrl?: string | null;
  brandColor: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeColor(value: string | null | undefined): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : FALLBACK_BRAND;
}

/** Same relative-luminance test the backend uses to pick ink for the brand bar. */
function onBrandText(brand: string): string {
  const hex = safeColor(brand).slice(1);
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.55 ? "#111827" : "#ffffff";
}

/**
 * Substitute `{{variable}}` with its sample value.
 *
 * An UNKNOWN variable is left visible and highlighted rather than silently
 * blanked — a typo'd `{{costumer_name}}` that renders as empty space is exactly
 * the bug this editor exists to prevent.
 */
export function substituteVariables(
  template: string,
  samples: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, rawName: string) => {
    const name = rawName.trim();
    if (name in samples) return escapeHtml(samples[name] ?? "");
    return (
      `<span style="background:#fee2e2;color:#991b1b;border-radius:3px;padding:0 3px;" ` +
      `title="Unknown variable">${escapeHtml(match)}</span>`
    );
  });
}

/** The default footer the backend appends when the template has none. */
function defaultFooter(business: PreviewBusiness): string {
  const contact = [business.phone, business.email, business.address]
    .filter((x): x is string => Boolean(x))
    .map(escapeHtml)
    .join(" &nbsp;·&nbsp; ");
  const parts = [`<strong>${escapeHtml(business.name)}</strong>`];
  if (contact) parts.push(contact);
  return parts.join("<br />");
}

/**
 * The full HTML document for the preview iframe.
 * A port of renderer.py's `_layout` — keep them in step.
 */
export function renderEmailPreview(
  template: PreviewTemplate,
  business: PreviewBusiness,
  samples: Readonly<Record<string, string>>,
): string {
  const brand = safeColor(template.primaryColor || business.brandColor);
  const ink = onBrandText(brand);

  const body = substituteVariables(template.bodyHtml, samples);
  const signature = template.signature ? substituteVariables(template.signature, samples) : "";
  const footer = template.footerHtml
    ? substituteVariables(template.footerHtml, samples)
    : defaultFooter(business);

  const header =
    template.showLogo && business.logoUrl
      ? `<img src="${escapeHtml(business.logoUrl)}" alt="${escapeHtml(business.name)}" width="128" style="display:block;border:0;max-width:160px;height:auto;margin:0 auto;" />`
      : `<span style="font-family:Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;letter-spacing:0.2px;color:${ink};">${escapeHtml(business.name)}</span>`;

  const signatureBlock = signature
    ? `<tr><td style="padding:0 32px 8px 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:${TEXT};">${signature}</td></tr>`
    : "";

  const footerBlock = footer
    ? `<tr><td align="center" style="padding:20px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:19px;color:${MUTED};">${footer}</td></tr>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${escapeHtml(template.subject)}</title>
<style>
  body { margin:0 !important; padding:0 !important; width:100% !important; }
  a { text-decoration:none; }
  @media only screen and (max-width:620px) {
    .wrap { width:100% !important; }
    .pad { padding-left:20px !important; padding-right:20px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BG};color:${TEXT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE_BG}" style="background-color:${PAGE_BG};margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:32px 12px;">
      <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
        <tr>
          <td align="center" bgcolor="${brand}" style="background-color:${brand};padding:28px 32px;border-radius:12px 12px 0 0;">
            ${header}
          </td>
        </tr>
        <tr>
          <td bgcolor="${CARD_BG}" style="background-color:${CARD_BG};border-radius:0 0 12px 12px;border:1px solid ${BORDER};border-top:0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="pad" style="padding:32px 32px 8px 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:${TEXT};">
                  ${body}
                </td>
              </tr>
              ${signatureBlock}
              <tr><td style="padding:16px 32px 24px 32px;">
                <div style="height:1px;line-height:1px;font-size:0;background-color:${BORDER};">&nbsp;</div>
              </td></tr>
            </table>
          </td>
        </tr>
        ${footerBlock}
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** The subject line, with variables filled in — shown above the preview. */
export function renderSubjectPreview(
  subject: string,
  samples: Readonly<Record<string, string>>,
): string {
  return subject.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, rawName: string) => {
    const name = rawName.trim();
    return name in samples ? (samples[name] ?? "") : match;
  });
}
