import type { Metadata } from "next";
import { Sora, Teko } from "next/font/google";
import "./globals.css";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const teko = Teko({
  variable: "--font-teko",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "BOUNCE — AFL Same Game Multi Scanner",
  description:
    "Deep-scan every AFL fixture for Same Game Multis using form, ins/outs, weather, ladder and venue edges.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sora.variable} ${teko.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
