import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getSiteConfig } from "@/lib/config";
import { themeCssVariables } from "@/lib/config/theme";
import "./globals.css";

export function generateMetadata(): Metadata {
  const config = getSiteConfig();
  return {
    title: `${config.event.name} — ${config.event.themeName}`,
    description: config.event.tagline,
  };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const config = getSiteConfig();

  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: `:root {\n${themeCssVariables(config)}\n}` }} />
      </head>
      <body className="min-h-screen bg-bg font-body text-text antialiased">{children}</body>
    </html>
  );
}
