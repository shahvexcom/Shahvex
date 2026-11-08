import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const logoData = await readFile(join(process.cwd(), "public", "img", "logo.png.png"), "base64");
const logoSrc = `data:image/png;base64,${logoData}`;

export const alt = "Shahvex — Intelligent Voice Workspace";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ height: "100%", width: "100%", display: "flex", position: "relative", overflow: "hidden", background: "linear-gradient(135deg, #f7f1ea 0%, #efe9e2 70%, #ffb17b 140%)", color: "#422717", padding: "72px" }}>
      <div style={{ position: "absolute", right: "-110px", top: "-130px", width: "560px", height: "560px", borderRadius: "50%", border: "2px solid rgba(232, 82, 10,.34)", boxShadow: "0 0 0 52px rgba(232, 82, 10,.10), 0 0 0 104px rgba(232, 82, 10,.06)" }} />
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center" }}><img src={logoSrc} width={240} height={56} alt="Shahvex" style={{ objectFit: "contain", objectPosition: "left center" }} /></div>
        <div style={{ display: "flex", flexDirection: "column" }}><div style={{ color: "#9c3c0d", fontSize: 21, letterSpacing: 4, fontWeight: 700 }}>INTELLIGENT VOICE OPERATIONS</div><div style={{ display: "flex", flexDirection: "column", fontSize: 68, lineHeight: 1.08, fontWeight: 800, marginTop: 20 }}><span>Every conversation,</span><span>in the right voice.</span></div><div style={{ color: "#6e5747", fontSize: 26, marginTop: 25 }}>Multilingual AI calling, managed from one workspace.</div></div>
        <div style={{ display: "flex", color: "#6e5747", fontSize: 20 }}>Voice agents · Call automation · Better conversations</div>
      </div>
    </div>,
    size,
  );
}

