import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "同行 · Together",
  description: "一起集合、聊天、各自探索。選一張地圖，和朋友開始今天的冒險。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">{children}</body>
    </html>
  );
}
