import type { Metadata, Viewport } from "next";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";
import { StatusRibbon } from "@/components/status-ribbon";
import { RoleProvider } from "@/components/role-context";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { currentRole } from "@/lib/auth";

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Jarvis Command Center",
  description: "The face on the Jarvis ops brain.",
  appleWebApp: {
    capable: true,
    title: "Jarvis",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0907",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const canWrite = (await currentRole()) === "owner";
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>
        <RoleProvider canWrite={canWrite}>
          <ServiceWorkerRegister />
          <StatusRibbon />
          <Nav />
          <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
        </RoleProvider>
      </body>
    </html>
  );
}
