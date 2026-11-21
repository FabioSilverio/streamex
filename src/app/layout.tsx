import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Barlow_Condensed } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Streamex — Twitch e Kick num lugar só",
  description:
    "Lives, VODs e clipes dos canais que você segue na Twitch e na Kick, com aviso quando alguém entra ao vivo e retomada de onde você parou.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} ${barlowCondensed.variable} dark h-full antialiased`}
    >
      <head>
        {/* Open connections to the video hosts early, so thumbnails and players start sooner */}
        <link rel="preconnect" href="https://player.twitch.tv" />
        <link rel="preconnect" href="https://static-cdn.jtvnw.net" />
        <link rel="preconnect" href="https://player.kick.com" />
        <link rel="preconnect" href="https://images.kick.com" />
        <link rel="preconnect" href="https://files.kick.com" />
        <link rel="dns-prefetch" href="https://stream.kick.com" />
        <link rel="dns-prefetch" href="https://i.ytimg.com" />
        <link rel="dns-prefetch" href="https://www.youtube.com" />
      </head>
      <body className="min-h-full bg-black text-white selection:bg-[#53FC18] selection:text-black overflow-x-hidden overscroll-y-none">
        {children}
      </body>
    </html>
  );
}
