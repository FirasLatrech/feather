import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { C, font } from "./theme";

// ───────── timeline (30 fps) ─────────
const S1 = 0, L1 = 95;      // logo
const S2 = 90, L2 = 120;    // problem
const S3 = 205, L3 = 220;   // hero UI
const S4 = 420, L4 = 150;   // speed
const S5 = 565, L5 = 225;   // features
const S6 = 785, L6 = 140;   // private + open source
const S7 = 920, L7 = 170;   // CTA
export const TOTAL_FRAMES = S7 + L7;

// ───────── helpers ─────────
const useFade = (len: number, inF = 12, outF = 12) => {
  const f = useCurrentFrame();
  const a = inF > 0 ? interpolate(f, [0, inF], [0, 1], { extrapolateRight: "clamp" }) : 1;
  const b = outF > 0 ? interpolate(f, [len - outF, len], [1, 0], { extrapolateLeft: "clamp" }) : 1;
  return Math.min(a, b);
};
const useRise = (delay = 0, damping = 200, stiffness = 120) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const p = spring({ frame: f - delay, fps, config: { damping, stiffness, mass: 1 } });
  return { opacity: p, transform: `translateY(${(1 - p) * 40}px)` };
};
const useScale = () => { const { width } = useVideoConfig(); return width / 1920; };

const Text = ({ children, size, weight = 600, color = C.black, style, align = "left" as const }: { children: React.ReactNode; size: number; weight?: number; color?: string; style?: React.CSSProperties; align?: "left" | "center" }) => {
  const s = useScale();
  return <div style={{ fontFamily: font, fontSize: size * s, fontWeight: weight, color, lineHeight: 1.1, letterSpacing: size > 60 ? "-0.03em" : "-0.01em", textAlign: align, textWrap: "balance" as never, ...style }}>{children}</div>;
};

const Window = ({ src, style }: { src: string; style?: React.CSSProperties }) => (
  <div style={{ borderRadius: 18, overflow: "hidden", boxShadow: "0 30px 80px rgba(20,15,5,.18), 0 2px 6px rgba(20,15,5,.08)", border: "1px solid rgba(0,0,0,.06)", background: "#fff", ...style }}>
    <Img src={staticFile(src)} style={{ width: "100%", display: "block" }} />
  </div>
);

const Pill = ({ children, bg = C.coral, color = "#fff", style }: { children: React.ReactNode; bg?: string; color?: string; style?: React.CSSProperties }) => {
  const s = useScale();
  return <div style={{ display: "inline-flex", alignItems: "center", gap: 8 * s, padding: `${8 * s}px ${16 * s}px`, borderRadius: 999, background: bg, color, fontFamily: font, fontWeight: 700, fontSize: 26 * s, letterSpacing: "-0.01em", boxShadow: "0 8px 24px rgba(20,15,5,.15)", ...style }}>{children}</div>;
};

const Counter = ({ from, to, start, len, format }: { from: number; to: number; start: number; len: number; format: (n: number) => string }) => {
  const f = useCurrentFrame();
  const v = interpolate(f, [start, start + len], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return <>{format(v)}</>;
};

const fmtMB = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(2)} GB` : `${Math.round(n)} MB`);

// ───────── scenes ─────────
const Logo = () => {
  const f = useCurrentFrame(); const { fps, width, height } = useVideoConfig(); const s = useScale();
  const pop = spring({ frame: f, fps, config: { damping: 14, stiffness: 120 } });
  const word = spring({ frame: f - 14, fps, config: { damping: 200, stiffness: 100 } });
  const tag = spring({ frame: f - 30, fps, config: { damping: 200, stiffness: 100 } });
  const op = useFade(L1, 0, 14);
  return (
    <AbsoluteFill style={{ background: C.paper, alignItems: "center", justifyContent: "center", opacity: op }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 * s }}>
        <Img src={staticFile("logo.png")} style={{ width: 200 * s, height: 200 * s, transform: `scale(${pop}) rotate(${(1 - pop) * -20}deg)`, opacity: pop }} />
        <Text size={120} weight={700} style={{ opacity: word, transform: `translateY(${(1 - word) * 30}px)` }}>Feather</Text>
        <Text size={40} weight={500} color={C.ink2} style={{ opacity: tag, transform: `translateY(${(1 - tag) * 20}px)` }}>Make your files lighter.</Text>
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, height: 6 * s, width: interpolate(f, [0, L1], [0, width]), background: C.coral }} />
      {height === width && null}
    </AbsoluteFill>
  );
};

const Problem = () => {
  const s = useScale(); const op = useFade(L2);
  const items = [
    { name: "keynote-final.mp4", size: 3121, kind: "MP4" },
    { name: "IMG_4821.HEIC", size: 3.9, kind: "HEIC" },
    { name: "Q3 deck.pdf", size: 27.1, kind: "PDF" },
    { name: "screen-recording.mov", size: 96, kind: "MOV" },
  ];
  return (
    <AbsoluteFill style={{ background: C.paper, opacity: op, padding: 120 * s, justifyContent: "center" }}>
      <Text size={84} weight={700} style={{ ...useRise(0), maxWidth: 1400 * s }}>Files are heavier than they need to be.</Text>
      <div style={{ display: "flex", gap: 20 * s, marginTop: 60 * s, flexWrap: "wrap" }}>
        {items.map((it, i) => (
          <div key={it.name} style={{ ...useRise(12 + i * 8), background: "#fff", border: `1px solid ${C.stone}`, borderRadius: 16 * s, padding: `${20 * s}px ${26 * s}px`, minWidth: 380 * s, display: "flex", alignItems: "center", gap: 18 * s, boxShadow: "0 8px 30px rgba(20,15,5,.06)" }}>
            <div style={{ fontFamily: font, fontWeight: 700, fontSize: 18 * s, background: C.black, color: "#fff", padding: `${4 * s}px ${8 * s}px`, borderRadius: 6 * s }}>{it.kind}</div>
            <div style={{ flex: 1 }}>
              <Text size={26} weight={600}>{it.name}</Text>
              <Text size={34} weight={700} color={C.coral} style={{ marginTop: 4 * s, fontVariantNumeric: "tabular-nums" }}>
                <Counter from={0} to={it.size} start={20 + i * 8} len={40} format={fmtMB} />
              </Text>
            </div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Hero = () => {
  const f = useCurrentFrame(); const { fps, width } = useVideoConfig(); const s = useScale(); const op = useFade(L3);
  const enter = spring({ frame: f, fps, config: { damping: 200, stiffness: 80 } });
  const swap = interpolate(f, [95, 110], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const zoom = interpolate(f, [0, L3], [1, 1.04]);
  const pill = spring({ frame: f - 118, fps, config: { damping: 12, stiffness: 140 } });
  const pill2 = spring({ frame: f - 130, fps, config: { damping: 12, stiffness: 140 } });
  const square = width < 1400;
  return (
    <AbsoluteFill style={{ background: C.paper, opacity: op, alignItems: "center", justifyContent: "flex-end", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: (square ? 70 : 90) * s, left: 0, right: 0, textAlign: "center", ...useRise(0) }}>
        <Text size={64} weight={700} align="center">Drop. Compress. Done.</Text>
        <Text size={30} weight={500} color={C.ink2} align="center" style={{ marginTop: 10 * s }}>Videos, images, GIFs and PDFs — in batches, with size estimates before you start.</Text>
      </div>
      <div style={{ width: (square ? 980 : 1380) * s, transform: `translateY(${(1 - enter) * 300 + (square ? 120 : 110) * s}px) scale(${zoom})`, transformOrigin: "50% 100%", position: "relative" }}>
        <Window src="ui/files.png" />
        <div style={{ position: "absolute", inset: 0, opacity: swap }}><Window src="ui/done.png" /></div>
        <div style={{ position: "absolute", left: "9%", top: "24%", transform: `scale(${pill})` }}><Pill>−65%</Pill></div>
        <div style={{ position: "absolute", left: "37%", top: "24%", transform: `scale(${pill2})` }}><Pill>−52%</Pill></div>
        <div style={{ position: "absolute", left: "1.5%", bottom: "-6%", transform: `scale(${pill2})` }}><Pill bg={C.ok}>↓ 325 MB saved · 65%</Pill></div>
      </div>
    </AbsoluteFill>
  );
};

const Speed = () => {
  const f = useCurrentFrame(); const { fps, width } = useVideoConfig(); const s = useScale(); const op = useFade(L4);
  const enter = spring({ frame: f, fps, config: { damping: 200, stiffness: 90 } });
  const square = width < 1400;
  return (
    <AbsoluteFill style={{ background: C.dark, opacity: op, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: (square ? 60 : 120) * s, top: (square ? 60 : 130) * s, maxWidth: (square ? 960 : 760) * s }}>
        <Text size={84} weight={700} color="#fff" style={useRise(0)}>Hardware-accelerated.</Text>
        <Text size={84} weight={700} color={C.coral} style={{ ...useRise(8), fontVariantNumeric: "tabular-nums" }}>
          <Counter from={1} to={20} start={10} len={45} format={(n) => `${n.toFixed(0)}× realtime`} />
        </Text>
        <Text size={30} weight={500} color="#b5afa4" style={{ ...useRise(16), marginTop: 20 * s }}>Apple VideoToolbox, H.265, AV1 — bitrate-aware, never spends more bits than the source.</Text>
      </div>
      <div style={{ position: "absolute", right: square ? "-10%" : (-40 * s), bottom: square ? (-380 * s) : (-60 * s), width: (square ? 1000 : 1150) * s, transform: `translateX(${(1 - enter) * 300}px) rotate(-3deg)`, transformOrigin: "100% 100%" }}>
        <Window src="ui/dark.png" style={{ boxShadow: "0 40px 100px rgba(0,0,0,.6)", border: "1px solid rgba(255,255,255,.08)" }} />
      </div>
    </AbsoluteFill>
  );
};

const Features = () => {
  const s = useScale(); const op = useFade(L5); const { width } = useVideoConfig(); const square = width < 1400;
  const feats = [
    { t: "Auto-compress folders", d: "Watch Downloads. New files get lighter on their own — optionally replacing the original.", img: "ui/settings.png" },
    { t: "Right-click in Finder", d: "“Compress with Feather” Quick Action, and Open With → Feather.", img: null },
    { t: "CLI + MCP server", d: "Let Claude or Cursor compress files for you — locally.", code: "feather-cli compress ~/Movies/*.mp4 --max 1920" },
  ];
  return (
    <AbsoluteFill style={{ background: C.paper, opacity: op, padding: (square ? 60 : 110) * s, justifyContent: "center" }}>
      <Text size={72} weight={700} style={useRise(0)}>Built for the workflow.</Text>
      <div style={{ display: "flex", flexDirection: square ? "column" : "row", gap: 24 * s, marginTop: 50 * s }}>
        {feats.map((ft, i) => (
          <div key={ft.t} style={{ ...useRise(14 + i * 10), flex: 1, background: "#fff", border: `1px solid ${C.stone}`, borderRadius: 20 * s, padding: 30 * s, boxShadow: "0 12px 40px rgba(20,15,5,.06)", display: "flex", flexDirection: "column", gap: 14 * s, minHeight: (square ? 200 : 460) * s }}>
            <div style={{ width: 44 * s, height: 44 * s, borderRadius: 12 * s, background: C.coral, display: "grid", placeItems: "center", color: "#fff", fontFamily: font, fontWeight: 700, fontSize: 22 * s }}>{i + 1}</div>
            <Text size={34} weight={700}>{ft.t}</Text>
            <Text size={24} weight={500} color={C.ink2}>{ft.d}</Text>
            {ft.code && (
              <div style={{ marginTop: "auto", background: C.black, color: "#fff", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 20 * s, padding: `${14 * s}px ${18 * s}px`, borderRadius: 12 * s, whiteSpace: "nowrap", overflow: "hidden" }}>
                <span style={{ color: C.coral }}>$ </span><Typewriter text={ft.code} start={40} />
              </div>
            )}
            {ft.img && !square && (
              <div style={{ marginTop: "auto", borderRadius: 12 * s, overflow: "hidden", border: `1px solid ${C.stone}`, height: 190 * s }}>
                <Img src={staticFile(ft.img)} style={{ width: "100%", marginTop: "-27%", display: "block" }} />
              </div>
            )}
            {!ft.img && !ft.code && !square && (
              <div style={{ marginTop: "auto", borderRadius: 12 * s, border: `1px solid ${C.stone}`, background: C.paper, padding: 16 * s, fontFamily: font, fontSize: 22 * s, color: C.black }}>
                <div style={{ padding: `${8 * s}px ${12 * s}px`, borderRadius: 8 * s, color: C.ink3 }}>Open With ▸</div>
                <div style={{ padding: `${8 * s}px ${12 * s}px`, borderRadius: 8 * s, background: C.coral, color: "#fff", fontWeight: 600 }}>Compress with Feather</div>
                <div style={{ padding: `${8 * s}px ${12 * s}px`, borderRadius: 8 * s, color: C.ink3 }}>Get Info</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Typewriter = ({ text, start }: { text: string; start: number }) => {
  const f = useCurrentFrame();
  const n = Math.max(0, Math.min(text.length, Math.floor((f - start) / 1.5)));
  return <>{text.slice(0, n)}<span style={{ opacity: Math.floor(f / 15) % 2 ? 0 : 1 }}>▍</span></>;
};

const Private = () => {
  const s = useScale(); const op = useFade(L6);
  const rows = ["100% on your device — nothing is uploaded", "Open source · MIT · free", "macOS · Apple Silicon & Intel"];
  return (
    <AbsoluteFill style={{ background: C.paper, opacity: op, alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 * s, alignItems: "center" }}>
        {rows.map((r, i) => (
          <div key={r} style={{ ...useRise(i * 10), display: "flex", alignItems: "center", gap: 18 * s }}>
            <div style={{ width: 18 * s, height: 18 * s, borderRadius: 999, background: C.coral }} />
            <Text size={i === 0 ? 64 : 44} weight={i === 0 ? 700 : 500} color={i === 0 ? C.black : C.ink2}>{r}</Text>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const CTA = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig(); const s = useScale(); const op = useFade(L7, 12, 0);
  const pop = spring({ frame: f, fps, config: { damping: 14, stiffness: 120 } });
  return (
    <AbsoluteFill style={{ background: C.paper, opacity: op, alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 * s }}>
        <Img src={staticFile("app-icon.png")} style={{ width: 220 * s, height: 220 * s, transform: `scale(${pop})` }} />
        <Text size={80} weight={700} align="center" style={useRise(10)}>Get Feather</Text>
        <Text size={34} weight={500} color={C.ink2} align="center" style={useRise(18)}>github.com/FirasLatrech/feather</Text>
        <div style={{ ...useRise(26), marginTop: 10 * s, background: C.black, color: "#fff", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 24 * s, padding: `${16 * s}px ${24 * s}px`, borderRadius: 14 * s }}>
          <span style={{ color: C.coral }}>$ </span>curl -fsSL https://raw.githubusercontent.com/FirasLatrech/feather/main/install.sh | sh
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Trailer = () => (
  <AbsoluteFill style={{ background: C.paper }}>
    <Sequence from={S1} durationInFrames={L1}><Logo /></Sequence>
    <Sequence from={S2} durationInFrames={L2}><Problem /></Sequence>
    <Sequence from={S3} durationInFrames={L3}><Hero /></Sequence>
    <Sequence from={S4} durationInFrames={L4}><Speed /></Sequence>
    <Sequence from={S5} durationInFrames={L5}><Features /></Sequence>
    <Sequence from={S6} durationInFrames={L6}><Private /></Sequence>
    <Sequence from={S7} durationInFrames={L7}><CTA /></Sequence>
  </AbsoluteFill>
);
