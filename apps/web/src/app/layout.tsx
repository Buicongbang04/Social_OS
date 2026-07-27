import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Social OS",
  description:
    "AI-Native Runtime Platform for Social Media, Marketing Automation and Digital Workforce",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
