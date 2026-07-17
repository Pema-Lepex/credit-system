/**
 * The binary half of the API.
 *
 * Uploads and PDFs deliberately do NOT go through GraphQL (see
 * backend/app/api/files.py): multipart in, streamed bytes out. GraphQL carries
 * only the resulting file *id*, which you then attach with a mutation.
 *
 * TOKEN REFRESH: `gqlRequest` owns the refresh-and-retry dance, and it is the only
 * thing that may run one (a second concurrent refresh would rotate the token out
 * from under the first). So when a REST call 401s we do not refresh ourselves — we
 * poke a cheap authenticated GraphQL query, let the transport layer refresh as a
 * side effect, and retry once with whatever access token is now in memory.
 */

import { API_URL, gqlRequest } from "@/lib/graphql/client";
import { getAccessToken } from "@/lib/auth/tokens";
import type { FileKind, ID } from "@/types";

const REST_PREFIX = `${API_URL.replace(/\/$/, "")}/api`;

/** Thrown for every non-2xx REST response, with the server's message when it sent one. */
export class RestRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RestRequestError";
    this.status = status;
  }
}

/** Triggers the transport layer's refresh path. Resolves false if the session is dead. */
async function tryRefreshSession(): Promise<boolean> {
  try {
    await gqlRequest<{ me: { id: string } }>(`query SessionPing { me { id } }`);
    return true;
  } catch {
    return false;
  }
}

async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const call = (): Promise<Response> => {
    const token = getAccessToken();
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };

  let response: Response;
  try {
    response = await call();
  } catch {
    throw new RestRequestError("Unable to reach the server. Is the API running?", 0);
  }

  if (response.status === 401 && (await tryRefreshSession())) {
    try {
      response = await call();
    } catch {
      throw new RestRequestError("Unable to reach the server. Is the API running?", 0);
    }
  }

  if (!response.ok) {
    throw new RestRequestError(await errorMessage(response), response.status);
  }
  return response;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "detail" in body) {
      const detail = (body as { detail: unknown }).detail;
      if (typeof detail === "string") return detail;
    }
  } catch {
    /* not JSON — fall through to the generic message */
  }
  if (response.status === 413) return "That file is too large.";
  if (response.status === 507) return "Your storage quota is full.";
  if (response.status === 403) return "You do not have permission to do that.";
  return `Request failed (${response.status}).`;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------
/** Mirrors the dict returned by POST /api/upload. */
export interface UploadedFile {
  id: ID;
  url: string | null;
  thumbnailUrl: string | null;
  filename: string;
  contentType: string;
  sizeBytes: number;
  originalSizeBytes: number;
  /** Bytes the server's image pipeline saved. Worth surfacing on a quota'd tier. */
  bytesSaved: number;
  width: number | null;
  height: number | null;
}

export async function uploadFile(file: File, kind: FileKind): Promise<UploadedFile> {
  const body = new FormData();
  body.append("file", file);

  // `kind` is a query param, not a form field — it is a FastAPI function arg.
  const response = await authedFetch(
    `${REST_PREFIX}/upload?kind=${encodeURIComponent(kind)}`,
    { method: "POST", body },
  );
  return (await response.json()) as UploadedFile;
}

// ---------------------------------------------------------------------------
// PDF download
// ---------------------------------------------------------------------------
/**
 * A PDF route needs a Bearer token, so the browser cannot simply follow a link —
 * we fetch it, turn the bytes into a Blob, and synthesise the download.
 */
async function downloadPdf(path: string, filename: string): Promise<void> {
  const response = await authedFetch(`${REST_PREFIX}${path}`);
  const blob = await response.blob();

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking synchronously can cancel the download in Safari; one frame is enough.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadInvoicePdf(creditId: ID, creditNumber: string): Promise<void> {
  return downloadPdf(`/credits/${creditId}/invoice.pdf`, `${creditNumber}.pdf`);
}

export function downloadReceiptPdf(paymentId: ID, paymentNumber: string): Promise<void> {
  return downloadPdf(`/payments/${paymentId}/receipt.pdf`, `${paymentNumber}.pdf`);
}

/**
 * A customer's whole account on one page: every credit, what they paid, what is
 * left. The document a customer actually asks for — not an invoice (one purchase)
 * and not a monthly statement (one billing period).
 *
 * `includeSettled` adds the fully-paid credits; by default the page answers the
 * question being asked ("what do I still owe") without burying it under paid rows.
 */
export function downloadCustomerStatementPdf(
  customerId: ID,
  customerCode: string,
  options: { includeSettled?: boolean } = {},
): Promise<void> {
  const query = options.includeSettled ? "?include_settled=true" : "";
  return downloadPdf(
    `/customers/${customerId}/statement.pdf${query}`,
    `statement-${customerCode}.pdf`,
  );
}
