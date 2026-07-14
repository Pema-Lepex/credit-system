import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <article className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="text-muted-foreground text-sm leading-relaxed">
        Placeholder. Replace with your counsel-reviewed policy before launch — this page exists
        so the sign-up flow has somewhere to link, not as legal advice.
      </p>
    </article>
  );
}
