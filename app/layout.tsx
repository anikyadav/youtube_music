import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YouTube MP3 Converter",
  description: "Experimental Next.js app to convert YouTube videos to MP3 and download them.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
