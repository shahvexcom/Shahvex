import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import "./ui-overrides.css";
import "./script-dropdown-fix.css";
import "./script-confirm-modal.css";
import "./rbac-toggle-fix.css";
import "./documents-library.css";
import "./button-fix.css";
import "./custom-report-filters.css";
import "./shahvex-theme.css";
import "./shahvex-fields.css";
import "./shahvex-bpo-details.css";
import "./shahvex-scripts.css";
import "./shahvex-operations.css";
import "./shahvex-settings.css";
import "./shahvex-bpo-workspace.css";
import "./shahvex-bpo-plans.css";
import "./shahvex-dialing.css";
import "./shahvex-landing-cards.css";
import "./landing-redesign.css";
import "./toggle-switches.css";
import { ToastProvider } from "@/app/components/toast-provider";
import { TooltipProvider } from "@/app/components/tooltip-provider";
import { CurrencyProvider } from "@/app/components/currency-provider";

const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://www.shahvex.com"
).replace(/\/$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Shahvex | Intelligent Voice Workspace",
    template: "%s | Shahvex",
  },
  description:
    "Shahvex helps teams run intelligent, multilingual voice operations with one focused workspace.",
  keywords: [
    "AI voice agent",
    "voice workspace",
    "call automation",
    "multilingual AI",
    "sales calls",
    "Shahvex",
  ],
  applicationName: "Shahvex",
  authors: [{ name: "Shahvex" }],
  creator: "Shahvex",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: siteUrl,
    locale: "en_US",
    siteName: "Shahvex",
    title: "Shahvex | Intelligent Voice Workspace",
    description:
      "Shahvex helps teams run intelligent, multilingual voice operations with one focused workspace.",
    images: [
      {
        url: `${siteUrl}/opengraph-image`,
        secureUrl: `${siteUrl}/opengraph-image`,
        type: "image/png",
        width: 1200,
        height: 630,
        alt: "Shahvex intelligent voice workspace",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Shahvex | Intelligent Voice Workspace",
    description:
      "Shahvex helps teams run intelligent, multilingual voice operations with one focused workspace.",
    images: [{ url: `${siteUrl}/opengraph-image`, alt: "Shahvex — Every Call. A New Opportunity." }],
  },
  icons: {
    icon: [
      { url: "/favicon.ico?v=shahvex2", sizes: "64x64", type: "image/x-icon" },
      { url: "/favicon-32x32.png?v=shahvex2", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png?v=shahvex2", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/favicon.ico?v=shahvex2",
    apple: { url: "/apple-touch-icon.png?v=shahvex2", sizes: "180x180", type: "image/png" },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const initialCurrency = (await cookies()).get("shahvex-currency")?.value === "PKR" ? "PKR" : "USD";
  return (
    <html lang="en" data-scroll-behavior="smooth" className="h-full antialiased">
      <body className="min-h-full flex flex-col"><CurrencyProvider initialCurrency={initialCurrency}>{children}<ToastProvider /><TooltipProvider /></CurrencyProvider></body>
    </html>
  );
}
