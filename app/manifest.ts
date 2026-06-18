import type { MetadataRoute } from "next";

// Web app manifest — makes the command center installable as a standalone
// home-screen app (full-screen, branded icon, warm-black theme).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jarvis Command Center",
    short_name: "Jarvis",
    description: "The face on the Jarvis ops brain.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0907",
    theme_color: "#0a0907",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
