import "./globals.css";

import type { Metadata } from "next";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "GymBro MCP",
  description: "Minimalist fitness coach with MCP + Supabase memory"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full bg-zinc-950 text-zinc-100`}>
        {children}
      </body>
    </html>
  );
}

