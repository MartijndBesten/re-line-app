import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Re-Line | Utiliteit",
  description:
    "Lokale werkbench voor historische installaties en commerciële opvolging",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
