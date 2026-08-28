import type { Metadata, Viewport } from "next";
import { Fraunces, Work_Sans, Space_Mono } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
});

const workSans = Work_Sans({
  variable: "--font-work-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Ledger",
  description: "One book for your time — speak your day, see where it goes, and know what deserves your energy.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${fraunces.variable} ${workSans.variable} ${spaceMono.variable}`}>
      <body style={{ minHeight: "100dvh" }}>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('ledger_theme');if(t&&t!=='light')document.documentElement.setAttribute('data-theme',t);}catch(e){}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
