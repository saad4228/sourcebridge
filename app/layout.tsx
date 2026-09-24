import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SourceBridge",
  description:
    "Turn one source into a coordinated communication package, with visible evidence and human control.",
  icons: { icon: "/favicon.svg" },
};

/**
 * Applies the stored theme before first paint.
 *
 * Without this, a dark-mode operator sees a white flash on every load: the
 * document renders with the default palette until React hydrates. Kept tiny and
 * dependency-free because it runs render-blocking in <head>.
 */
const THEME_SCRIPT = `
try {
  var t = localStorage.getItem('sourcebridge-theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
