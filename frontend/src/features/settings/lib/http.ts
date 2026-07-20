/**
 * The binary edge of the API.
 *
 * Uploads and downloads deliberately do NOT go through GraphQL (see
 * backend/app/api/files.py) — they are multipart in / octet-stream out. That
 * means they also miss out on `gqlRequest`'s 401-refresh interceptor, so this
 * module re-implements the one part of it that matters: on a 401, force a token
 * refresh and retry exactly once.
 *
 * The refresh is triggered by making any authenticated GraphQL call — `me` is the
 * cheapest — because `gqlRequest` already owns the de-duplicated refresh promise.
 * Re-implementing the refresh here would race with it.
 */

import { ME_QUERY } from "@/lib/auth/queries";
import { API_URL, gqlRequest } from "@/lib/graphql/client";
import { getAccessToken } from "@/lib/auth/tokens";
import type { FileKind, ID } from "@/types";

export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * Backend `detail` is either a string or FastAPI's validation-error array.
 *
 * Exported for the other features that talk to the binary API (reports, imports)
 * so there is one place that knows how FastAPI shapes an error body.
 */
export async function messageFromResponse(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "detail" in body) {
      const detail = (body as { detail: unknown }).detail;
      if (typeof detail === "string") return detail;
    }
  } catch {
    /* not JSON — use the fallback */
  }
  return fallback;
}

/**
 * Run an authenticated fetch, refreshing the access token once on a 401.
 * The callback receives the current token so the retry sends the NEW one.
 *
 * Exported: this refresh-and-retry dance must exist exactly once. A second copy
 * would race the first for the refresh token and rotate it out from under it.
 */
export async function authedFetch(
  run: (token: string | null) => Promise<Response>,
): Promise<Response> {
  let response = await run(getAccessToken());
  if (response.status !== 401) return response;

  try {
    // Piggy-backs on gqlRequest's single in-flight refresh; on failure it clears
    // the session and redirects, and this rejects.
    await gqlRequest<{ me: unknown }>(ME_QUERY);
  } catch {
    throw new HttpError("Your session has expired. Please sign in again.", 401);
  }

  response = await run(getAccessToken());
  return response;
}

export interface UploadedFile {
  id: ID;
  url: string | null;
  thumbnailUrl: string | null;
  filename: string;
  contentType: string;
  sizeBytes: number;
  originalSizeBytes: number;
  /** What image compression saved on this one file. The UI is allowed to brag. */
  bytesSaved: number;
  width: number | null;
  height: number | null;
}

/**
 * POST /api/upload?kind=… — returns the FileAsset id to hand to a GraphQL
 * mutation (`logoFileId`, `avatarFileId`, …).
 */
export async function uploadFile(file: File, kind: FileKind): Promise<UploadedFile> {
  const body = new FormData();
  body.append("file", file);

  const response = await authedFetch((token) =>
    fetch(`${API_URL}/api/upload?kind=${encodeURIComponent(kind)}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body,
    }),
  );

  if (!response.ok) {
    throw new HttpError(
      await messageFromResponse(
        response,
        response.status === 413
          ? "That file is too large."
          : "Upload failed. Please try again.",
      ),
      response.status,
    );
  }

  return (await response.json()) as UploadedFile;
}

/**
 * Absolute-ise a storage URL: the backend hands back paths relative to itself.
 *
 * Now an alias for the single shared implementation in `@/lib/media`. The old local
 * copy also mishandled `blob:` and `data:` URLs — it treated them as relative and
 * prefixed the API origin, corrupting the in-flight upload preview.
 */
export { assetUrl as absoluteUrl } from "@/lib/media";

/**
 * GET a binary endpoint with the bearer token and save it to disk.
 *
 * A plain <a href> cannot carry an Authorization header, which is why the file is
 * pulled as a blob and handed to a synthetic anchor. The object URL is revoked
 * afterwards — without that, the whole file stays pinned in memory for the life
 * of the tab.
 */
export async function downloadFile(path: string, fallbackFilename: string): Promise<void> {
  const response = await authedFetch((token) =>
    fetch(`${API_URL}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }),
  );

  if (!response.ok) {
    throw new HttpError(
      await messageFromResponse(
        response,
        response.status === 410
          ? "This file has expired and is no longer available."
          : "Download failed.",
      ),
      response.status,
    );
  }

  // Honour the server's filename when it sends one.
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] ?? fallbackFilename;

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

/**
 * GET a binary endpoint with the bearer token and open it INLINE in a new tab.
 *
 * Same auth dance as downloadFile — an <a target="_blank"> can't carry a bearer
 * token, so we pull the bytes as a blob first. Wrapping them in a blob URL also
 * drops the server's `Content-Disposition: attachment`, so the browser renders the
 * file instead of saving it: PDFs and JSON/CSV display inline; a format the browser
 * cannot render (XLSX) simply downloads, which is the right fallback.
 *
 * The object URL is revoked on a delay, NOT immediately: revoking it now would pull
 * the bytes out from under the tab before it has finished loading them.
 */
export async function viewFile(path: string): Promise<void> {
  // THE TAB IS OPENED HERE, SYNCHRONOUSLY, BEFORE ANY await. Two separate reasons,
  // and the first one is why "View" used to download every single time:
  //
  //  1. `window.open(url, "_blank", "noopener")` returns null BY SPECIFICATION —
  //     not only when a popup is blocked. The old code read that null as "popup
  //     blocked" and fell through to an <a download> click, so View silently
  //     downloaded the file on every browser, every time.
  //
  //  2. Even without that, calling window.open AFTER an await puts it outside the
  //     user gesture, and popup blockers refuse it.
  //
  // `noopener` is dropped deliberately: the tab is handed a same-origin blob: URL
  // we created ourselves, not untrusted third-party content, so there is no
  // tabnabbing surface to defend against — and we need the handle to navigate it.
  const tab = window.open("about:blank", "_blank");

  try {
    const response = await authedFetch((token) =>
      fetch(`${API_URL}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }),
    );

    if (!response.ok) {
      throw new HttpError(
        await messageFromResponse(
          response,
          response.status === 410
            ? "This file has expired and is no longer available."
            : "Could not open the file.",
        ),
        response.status,
      );
    }

    if (!tab) {
      // A genuine popup block. SAY SO rather than downloading instead — starting a
      // download the user did not ask for is precisely the bug above.
      throw new HttpError(
        "Your browser blocked the new tab. Allow pop-ups for this site, or use Download instead.",
        0,
      );
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    tab.location.href = objectUrl;

    // Give the tab time to fetch the bytes before releasing them.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    // Never strand a blank tab behind a failure.
    tab?.close();
    throw error;
  }
}
