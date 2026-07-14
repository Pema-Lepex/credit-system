import { redirect } from "next/navigation";

/**
 * There is no marketing site here — `/` is the app. Middleware has already sent
 * unauthenticated visitors to /login, so anyone reaching this belongs on the
 * dashboard.
 */
export default function RootPage() {
  redirect("/dashboard");
}
