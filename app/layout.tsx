import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const ibmPlexSans = IBM_Plex_Sans({
  display: "swap",
  preload: false,
  subsets: ["latin"],
  variable: "--font-ibm-plex-sans",
  weight: "variable",
});

export const metadata: Metadata = {
  title: {
    default: "Cadence Tracker",
    template: "%s | Cadence Tracker",
  },
  description: "A private behavior tracker for recurring life patterns.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        suppressHydrationWarning
        className={`${ibmPlexSans.className} ${ibmPlexSans.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
