import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { UnlockScreen } from "@/openhiggsfield/unlock-screen";

import "@/openhiggsfield/openhiggsfield.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-ohf-inter",
  display: "swap",
});

/* The proxy serves this in place of whatever was asked for, so it is never a
   destination of its own — and never a page worth indexing. */
export const metadata: Metadata = {
  title: "Access code",
  robots: { index: false, follow: false },
};

export default function UnlockPage() {
  return <UnlockScreen fontClassName={inter.variable} />;
}
