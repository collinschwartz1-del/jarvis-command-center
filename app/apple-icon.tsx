import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS home-screen icon. iOS ignores SVG/maskable, so this generated PNG is what
// shows when Collin taps "Add to Home Screen". Solid bg (iOS masks corners).
export default function AppleIcon() {
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
          fontSize: 120,
          fontWeight: 700,
          fontFamily: "sans-serif",
        }}
      >
        J
      </div>
    ),
    { ...size }
  );
}
