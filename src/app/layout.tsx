import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BloomAR Manager | Medical Billing & Accounts Receivable",
  description: "Enterprise healthcare revenue cycle management software for AR, billing operations, and claims management.",
  icons: { icon: "/logo-mark.svg" },
  openGraph: { images: ["/logo.svg"] },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-[#F5F7FA] text-slate-900 antialiased font-sans">
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
