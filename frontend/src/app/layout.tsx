import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Providers } from "@/components/providers";

import "./globals.css";

// next/font self-hosts the files and inlines a font-face with size-adjust, which
// removes the layout shift a webfont normally causes. The CSS var is what
// globals.css binds --font-sans to.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Credit Manager",
    template: "%s · Credit Manager",
  },
  description:
    "Track customer credit, collect payments on time, and never chase a due date by hand again.",
  applicationName: "Credit Manager",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover is what makes env(safe-area-inset-*) resolve to non-zero
  // on notched iPhones — without it `.pb-safe` is a no-op.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning is REQUIRED by next-themes: it writes the `class`
    // and `style` on <html> from an inline script before React hydrates, so the
    // server and client markup legitimately differ on exactly this element.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
