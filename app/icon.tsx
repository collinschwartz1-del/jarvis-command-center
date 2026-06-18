import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

// Generated PWA / favicon icon: amber "J" monogram on warm-black, matching the
// Mission Control palette. Rendered to PNG at build time.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0907",
          color: "#fbbf24",
          fontSize: 340,
          fontWeight: 700,
          fontFamily: "sans-serif",
          borderRadius: 96,
        }}
      >
        J
      </div>
    ),
    { ...size }
  );
}
