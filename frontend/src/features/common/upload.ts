/**
 * Binary upload — REST, not GraphQL.
 *
 * The API deliberately keeps binaries off the GraphQL wire (see backend
 * api/files.py): POST multipart to /api/upload, get a FileAsset id back, then
 * hand that id to a mutation as `photoFileId` / `imageFileIds`.
 *
 * The response also reports how many bytes the server's compression saved. We
 * surface that: it is the difference between "uploading…" and "we just saved you
 * 1.4 MB of your quota".
 */

import { API_URL } from "@/lib/graphql/client";
import { getAccessToken } from "@/lib/auth/tokens";
import { assetUrl } from "@/features/common/media";
import type { FileKind, ID } from "@/types";

export interface UploadedFile {
  id: ID;
  url: string;
  thumbnailUrl: string | null;
  filename: string;
  contentType: string;
  sizeBytes: number;
  originalSizeBytes: number;
  /** originalSizeBytes - sizeBytes. Zero for already-optimal files. */
  bytesSaved: number;
  width: number | null;
  height: number | null;
}

export class UploadError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "UploadError";
    this.status = status;
  }
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Client-side gate. The server re-checks — this just saves a doomed round trip. */
export function validateImage(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return "Choose a JPEG, PNG, WebP or GIF image.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`;
  }
  return null;
}

export async function uploadFile(
  file: File,
  kind: FileKind,
  signal?: AbortSignal,
): Promise<UploadedFile> {
  const token = getAccessToken();
  const body = new FormData();
  body.append("file", file);

  const endpoint = `${API_URL.replace(/\/$/, "")}/api/upload?kind=${encodeURIComponent(kind)}`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      // No Content-Type header: the browser must set the multipart boundary itself.
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body,
      signal,
    });
  } catch {
    throw new UploadError("Upload failed — is the server reachable?");
  }

  if (!response.ok) {
    const detail = await response
      .json()
      .then((data: { detail?: string }) => data.detail)
      .catch(() => undefined);
    throw new UploadError(detail ?? `Upload failed (${response.status})`, response.status);
  }

  const file_ = (await response.json()) as UploadedFile;

  // The local backend hands back "/api/files/…" — relative to the API, not to us.
  return {
    ...file_,
    url: assetUrl(file_.url) ?? file_.url,
    thumbnailUrl: assetUrl(file_.thumbnailUrl) ?? null,
  };
}
