import type { Metadata, Viewport } from "next";
import { Archivo_Black, Geist_Mono, Oswald, Source_Sans_3 } from "next/font/google";
import { AppShell } from "@/components/layout/AppShell";
import "./globals.css";

const oswald = Oswald({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const archivoBlack = Archivo_Black({
  variable: "--font-logo",
  subsets: ["latin"],
  weight: "400",
});

const sourceSans = Source_Sans_3({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "No.3 Darts | Craft Beer Bar",
  description:
    "Darts scoring for No.3 Craft Beer Bar, Cape Coral — TV board + iPad control, camera-ready.",
  applicationName: "No.3 Darts",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "No.3 Darts",
  },
  formatDetection: {
    telephone: false,
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/brand/logo.png", sizes: "467x450", type: "image/png" }],
    apple: [{ url: "/brand/logo.png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#e10600",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${oswald.variable} ${archivoBlack.variable} ${sourceSans.variable} ${geistMono.variable} antialiased`}
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
