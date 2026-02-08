import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { BgCanvas } from "@/components/BgCanvas";
import { BackgroundEffectProvider } from "@/components/BackgroundContext";
import { ContentGate } from "@/components/ContentGate";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Aegis — DeFi Transaction Security",
  description:
    "AI-powered transaction security for DeFi. ML risk scoring, VDF time-locks, FROST threshold signatures, and ZK-proof guardian voting.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <head>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🛡️</text></svg>" />
      </head>
      <body className="font-sans antialiased">
        <BackgroundEffectProvider>
          <BgCanvas />
          <ContentGate>{children}</ContentGate>
        </BackgroundEffectProvider>
      </body>
    </html>
  );
}
