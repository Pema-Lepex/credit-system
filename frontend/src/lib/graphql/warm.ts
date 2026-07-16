"use client";

/**
 * Wake the backend early.
 *
 * The API runs on a scale-to-zero host (Render free tier) that sleeps after
 * ~15 minutes idle and takes 30-50s to cold-boot. A visitor who lands on the
 * login page and then submits is likely the FIRST request after a sleep, so they
 * eat that whole boot on the login round-trip.
 *
 * The fix: fire a cheap, unauthenticated GET /health the moment an auth page
 * mounts. The server starts booting while the user is still reading the form and
 * typing their password, so by submit time it is usually already awake. This does
 * not make a cold boot shorter — it just moves it off the critical path.
 *
 * Deliberately fire-and-forget: a warm-up that fails changes nothing (the real
 * request will surface any genuine outage), so every error is swallowed.
 */

import { API_URL } from "@/lib/graphql/client";

const HEALTH_URL = `${API_URL.replace(/\/$/, "")}/health`;

/**
 * How long to consider a warm-up "recent enough" to skip. A page navigation
 * between two auth screens (login -> register) inside this window should not fire
 * a second ping — the server is already on its way up.
 */
const WARM_TTL_MS = 60_000;

let lastWarmedAt = 0;
let inFlight = false;

/**
 * Ping /health unless we pinged within the last minute. Safe to call on every
 * auth-page mount and from anywhere; concurrent and rapid-repeat calls collapse
 * into a single network hit.
 */
export function warmBackend(): void {
  if (typeof window === "undefined") return;

  const now = Date.now();
  if (inFlight || now - lastWarmedAt < WARM_TTL_MS) return;

  inFlight = true;
  lastWarmedAt = now;

  // AbortController caps how long we hold the connection open — a cold boot can
  // take ~60s, but we don't need the response, only to have started the boot.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  void fetch(HEALTH_URL, {
    method: "GET",
    signal: controller.signal,
    // No cookies/auth needed; keep it as light as possible.
    credentials: "omit",
    cache: "no-store",
  })
    .catch(() => {
      // A failed warm-up is not an error worth surfacing — reset the timestamp so
      // the next mount is free to try again rather than being throttled by a ping
      // that never landed.
      lastWarmedAt = 0;
    })
    .finally(() => {
      clearTimeout(timeout);
      inFlight = false;
    });
}
