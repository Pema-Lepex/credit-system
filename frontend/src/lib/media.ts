/**
 * Turning a stored file path into something a browser can actually load.
 *
 * The API returns file URLs RELATIVE to itself ("/api/files/<hash>.webp" — see the
 * backend's StorageService.url_for). The frontend is served from a different origin
 * (localhost:3000, or Vercel), so handing that string straight to <img src> resolves
 * it against the FRONTEND, where nothing is at that path. The request 404s, the
 * <Image> onError fires, and the avatar silently falls back to initials — which is
 * exactly what "my uploaded photo never shows" looks like.
 *
 * This lived in two feature modules under two names (`absoluteUrl`, `assetUrl`), and
 * every consumer had to remember to call one of them. Several did not. It now lives
 * in lib/, and the Avatar/image components apply it THEMSELVES, so a caller cannot
 * forget it.
 *
 * Left alone: absolute http(s) URLs (an S3/R2 bucket once STORAGE_BACKEND=s3), and
 * blob:/data: URLs (the local preview shown while an upload is still in flight).
 */

import { API_URL } from "@/lib/graphql/client";

export function assetUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  return `${API_URL.replace(/\/$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Non-null variant for a `[String!]!` list of image URLs. */
export function assetUrls(urls: readonly string[] | null | undefined): string[] {
  return (urls ?? []).map((url) => assetUrl(url)).filter((url): url is string => Boolean(url));
}
