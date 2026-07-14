/**
 * Turn a stored file URL into one the browser can actually fetch.
 *
 * The API returns ROOT-RELATIVE paths for local storage ("/api/files/…"), which
 * the backend serves on :8000 — but the frontend runs on :3000, so dropping that
 * string straight into an <img src> requests it from Next and 404s. The S3/R2
 * backend, by contrast, returns a fully-qualified https:// URL.
 *
 * So: absolute (or data:) URLs pass through untouched; relative ones are resolved
 * against the API origin. One helper, used at every render site, and the day
 * storage moves to a CDN nothing here changes.
 */

import { API_URL } from "@/lib/graphql/client";

export function assetUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  return `${API_URL.replace(/\/$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Non-null variant for `imageUrls: [String!]!`. */
export function assetUrls(urls: readonly string[] | null | undefined): string[] {
  return (urls ?? []).map((url) => assetUrl(url)).filter((url): url is string => Boolean(url));
}
