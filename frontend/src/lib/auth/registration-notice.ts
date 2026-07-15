/**
 * Client-side "a new store owner registered" notice to the super-admin.
 *
 * WHY THIS RUNS IN THE BROWSER, not on the server
 * -----------------------------------------------
 * The notice is delivered through W3Forms (web3forms.com), whose free tier ACCEPTS a
 * submission from a browser but REJECTS one from a server IP (HTTP 403, "Use our API
 * in client side ... Pro plan is required"). The backend still attempts the send for
 * anyone on a paid plan, but on the free plan that server-side call silently fails —
 * so we ALSO fire it here, from the page the user just submitted, where W3Forms is
 * happy to accept it. The super-admin gets the email either way.
 *
 * A W3Forms access key is safe to expose to the browser: its only power is to POST a
 * message to the operator's own inbox (it reads nothing), which is exactly how every
 * public W3Forms contact form on the web already uses it. The key is fetched from the
 * public `registrationNoticeKey` query (dashboard-configured key first, then env).
 *
 * BEST-EFFORT BY CONTRACT: this must NEVER fail or delay a registration. Every path
 * swallows its error, and the request uses `keepalive` so it still completes after
 * the page navigates away to the dashboard.
 */

import { gqlPublicRequest } from "@/lib/graphql/client";
import { REGISTRATION_NOTICE_KEY_QUERY } from "@/lib/auth/queries";

const W3FORMS_ENDPOINT = "https://api.web3forms.com/submit";

export interface RegistrationNoticeDetails {
  businessName: string;
  ownerName: string;
  email: string;
}

export async function notifySuperAdminOfSignup(
  details: RegistrationNoticeDetails,
): Promise<void> {
  try {
    const data = await gqlPublicRequest<{ registrationNoticeKey: string | null }>(
      REGISTRATION_NOTICE_KEY_QUERY,
    );
    const accessKey = data.registrationNoticeKey;
    if (!accessKey) return; // no key configured — nothing to send, and that's fine

    const when = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

    await fetch(W3FORMS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      // `keepalive` lets the POST outlive the redirect to /dashboard that fires
      // immediately after this call.
      keepalive: true,
      body: JSON.stringify({
        access_key: accessKey,
        subject: `New store owner registered: ${details.businessName}`,
        from_name: "Credit Manager",
        botcheck: "", // W3Forms honeypot: must be present and empty
        // W3Forms renders unknown keys into the relayed email as a readable block.
        message:
          `A new store owner has just signed up and is awaiting approval.\n\n` +
          `Business : ${details.businessName}\n` +
          `Owner    : ${details.ownerName}\n` +
          `Email    : ${details.email}\n` +
          `When     : ${when}\n\n` +
          `Open the Super Admin panel to review and approve this account.`,
        business_name: details.businessName,
        owner_name: details.ownerName,
        owner_email: details.email,
        registered_at: when,
      }),
    });
  } catch {
    /* best-effort: a notification must never break a registration */
  }
}
