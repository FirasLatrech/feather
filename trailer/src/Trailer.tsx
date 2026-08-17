import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { C, font } from "./theme";

/* ───────────────────────────── motion system ─────────────────────────────
   60 fps · one easing (ease-out cubic) · durations in ms · no bounce.        */
const FPS = 60;
const ms = (m: number) => Math.round((m / 1000) * FPS);
const EASE = Easing.out(Easing.cubic);
const EASE_IO = Easing.inOut(Easing.cubic);

/** 0→1 progress starting at `delayMs`, lasting `durMs`, ease-out. */
const useT = (delayMs: number, durMs = 700) => {
  const f = useCurrentFrame();
  return interpolate(f, [ms(delayMs), ms(delayMs) + ms(durMs)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
};
/** Fade + rise-in style. */
const useIn = (delayMs: number, dist = 28, durMs = 700): React.CSSProperties => {
  const t = useT(delayMs, durMs);
  return { opacity: t, transform: `translateY(${(1 - t) * dist}px)` };
};
/** Slow continuous drift over the whole scene (camera feel). */
const useDrift = (lenFrames: number, from: number, to: number) => {
  const f = useCurrentFrame();
  return interpolate(f, [0, lenFrames], [from, to], { extrapolateRight: "clamp", easing: Easing.linear });
};
const useScale = () => useVideoConfig().width / 1920;

const Text = ({ children, size, weight = 600, color = C.black, style, align = "left" as const }: { children: React.ReactNode; size: number; weight?: number; color?: string; style?: React.CSSProperties; align?: "left" | "center" }) => {
  const s = useScale();
  return <div style={{ fontFamily: font, fontSize: size * s, fontWeight: weight, color, lineHeight: 1.08, letterSpacing: size >= 60 ? "-0.03em" : "-0.012em", textAlign: align, textWrap: "balance" as never, ...style }}>{children}</div>;
};

/** macOS-style window with traffic lights, on the real wallpaper. */
const MacWindow = ({ src, style, dark }: { src: string; style?: React.CSSProperties; dark?: boolean }) => (
  <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", boxShadow: "0 0 0 1px rgba(255,255,255,.14), 0 40px 120px rgba(0,0,0,.45), 0 6px 18px rgba(0,0,0,.25)", background: dark ? "#141311" : "#fff", ...style }}>
    <Img src={staticFile(src)} style={{ width: "100%", display: "block" }} />
    <div style={{ position: "absolute", left: 16, top: 18, display: "flex", gap: 8 }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => <i key={c} style={{ width: 12, height: 12, borderRadius: 999, background: c, display: "block", boxShadow: "inset 0 0 0 .5px rgba(0,0,0,.15)" }} />)}
    </div>
  </div>
);

const Wallpaper = ({ dim = 0 }: { dim?: number }) => (
  <AbsoluteFill>
    <Img src={staticFile("wallpaper.jpg")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    <AbsoluteFill style={{ background: `rgba(0,0,0,${dim})` }} />
  </AbsoluteFill>
);

const Pill = ({ children, bg = C.coral, color = "#fff", delayMs, style }: { children: React.ReactNode; bg?: string; color?: string; delayMs: number; style?: React.CSSProperties }) => {
  const s = useScale(); const t = useT(delayMs, 500);
  return <div style={{ position: "absolute", display: "inline-flex", alignItems: "center", padding: `${9 * s}px ${18 * s}px`, borderRadius: 999, background: bg, color, fontFamily: font, fontWeight: 700, fontSize: 28 * s, letterSpacing: "-0.01em", boxShadow: "0 10px 30px rgba(20,15,5,.22)", opacity: t, transform: `translateY(${(1 - t) * 14}px) scale(${0.9 + 0.1 * t})`, ...style }}>{children}</div>;
};

const Counter = ({ from, to, delayMs, durMs, format }: { from: number; to: number; delayMs: number; durMs: number; format: (n: number) => string }) => {
  const f = useCurrentFrame();
  const v = interpolate(f, [ms(delayMs), ms(delayMs) + ms(durMs)], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IO });
  return <>{format(v)}</>;
};

/* ───────────────────────────── scenes ───────────────────────────── */

const Intro = () => {
  const s = useScale(); const f = useCurrentFrame();
  const logo = useT(0, 900); const word = useIn(350, 24, 800); const tag = useIn(700, 18, 800);
  const line = interpolate(f, [ms(200), ms(2400)], [0, 1], { extrapolateRight: "clamp", easing: EASE_IO });
  return (
    <AbsoluteFill style={{ background: C.paper, alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 * s }}>
        <Img src={staticFile("logo.png")} style={{ width: 190 * s, height: 190 * s, opacity: logo, transform: `scale(${0.85 + 0.15 * logo}) translateY(${(1 - logo) * 10}px)` }} />
        <Text size={124} weight={700} style={word}>Feather</Text>
        <Text size={40} weight={500} color={C.ink2} style={tag}>Make your files lighter.</Text>
      </div>
      <div style={{ position: "absolute", left: "50%", bottom: 140 * s, width: 160 * s, height: 4 * s, background: C.stone, borderRadius: 999, transform: "translateX(-50%)", overflow: "hidden" }}>
        <div style={{ width: `${line * 100}%`, height: "100%", background: C.coral }} />
      </div>
    </AbsoluteFill>
  );
};

const Problem = ({ len }: { len: number }) => {
  const s = useScale();
  const items = [
    { name: "keynote-final.mp4", size: 3121, kind: "MP4" },
    { name: "IMG_4821.HEIC", size: 3.9, kind: "HEIC" },
    { name: "Q3 deck.pdf", size: 27.1, kind: "PDF" },
    { name: "screen-recording.mov", size: 96, kind: "MOV" },
  ];
  const fmt = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(2)} GB` : `${n < 10 ? n.toFixed(1) : Math.round(n)} MB`);
  const drift = useDrift(len, 0, -20);
  return (
    <AbsoluteFill style={{ background: C.paper, justifyContent: "center", padding: `0 ${140 * s}px` }}>
      <div style={{ transform: `translateY(${drift * s}px)` }}>
        <Text size={92} weight={700} style={{ ...useIn(0), maxWidth: 1500 * s }}>Files are heavier than they need to be.</Text>
        <div style={{ display: "flex", gap: 22 * s, marginTop: 64 * s, flexWrap: "wrap" }}>
          {items.map((it, i) => (
            <div key={it.name} style={{ ...useIn(400 + i * 120, 34, 800), background: "#fff", border: `1px solid ${C.stone}`, borderRadius: 18 * s, padding: `${22 * s}px ${28 * s}px`, minWidth: 380 * s, display: "flex", alignItems: "center", gap: 18 * s, boxShadow: "0 10px 34px rgba(20,15,5,.06)" }}>
              <div style={{ fontFamily: font, fontWeight: 700, fontSize: 18 * s, background: C.black, color: "#fff", padding: `${4 * s}px ${8 * s}px`, borderRadius: 6 * s }}>{it.kind}</div>
              <div>
                <Text size={26} weight={600}>{it.name}</Text>
                <Text size={36} weight={700} color={C.coral} style={{ marginTop: 4 * s, fontVariantNumeric: "tabular-nums" }}>
                  <Counter from={0} to={it.size} delayMs={600 + i * 120} durMs={1100} format={fmt} />
                </Text>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Hero = ({ len }: { len: number }) => {
  const s = useScale(); const f = useCurrentFrame(); const { width } = useVideoConfig();
  const enter = useT(0, 1100);
  const zoom = useDrift(len, 1.0, 1.045);
  const swap1 = interpolate(f, [ms(2600), ms(3300)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IO }); // files → running
  const swap2 = interpolate(f, [ms(4600), ms(5300)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IO }); // running → done
  const winW = Math.min(1360 * s, width * 0.72);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Wallpaper dim={0.08} />
      <div style={{ position: "absolute", top: 84 * s, left: 0, right: 0, textAlign: "center", ...useIn(200) }}>
        <Text size={64} weight={700} align="center" color="#fff" style={{ textShadow: "0 2px 24px rgba(0,0,0,.35)" }}>Drop. Compress. Done.</Text>
        <Text size={28} weight={500} align="center" color="rgba(255,255,255,.85)" style={{ marginTop: 10 * s, textShadow: "0 1px 12px rgba(0,0,0,.35)" }}>Videos, images, GIFs and PDFs — with size estimates before you start.</Text>
      </div>
      <div style={{ position: "absolute", left: "50%", bottom: -30 * s, width: winW, transform: `translateX(-50%) translateY(${(1 - enter) * 260}px) scale(${zoom})`, transformOrigin: "50% 100%", opacity: Math.min(1, enter * 1.6) }}>
        <MacWindow src="ui/files.png" />
        <div style={{ position: "absolute", inset: 0, opacity: swap1 }}><MacWindow src="ui/running.png" /></div>
        <div style={{ position: "absolute", inset: 0, opacity: swap2 }}><MacWindow src="ui/done.png" /></div>
        <Pill delayMs={5500} style={{ left: "10%", top: "22%" }}>−65%</Pill>
        <Pill delayMs={5650} style={{ left: "37%", top: "22%" }}>−52%</Pill>
        <Pill delayMs={5800} style={{ left: "13%", top: "50%" }}>−65%</Pill>
        <Pill delayMs={6100} bg={C.ok} style={{ left: "2%", bottom: "5.5%" }}>↓ 346 MB saved · 65%</Pill>
      </div>
    </AbsoluteFill>
  );
};

const Speed = ({ len }: { len: number }) => {
  const s = useScale(); const { width } = useVideoConfig();
  const enter = useT(0, 1200); const pan = useDrift(len, 0, -60);
  return (
    <AbsoluteFill style={{ background: C.dark, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 130 * s, top: 150 * s, maxWidth: 800 * s }}>
        <Text size={88} weight={700} color="#fff" style={useIn(100)}>Hardware-accelerated.</Text>
        <Text size={88} weight={700} color={C.coral} style={{ ...useIn(250), fontVariantNumeric: "tabular-nums" }}>
          <Counter from={1} to={20} delayMs={500} durMs={1600} format={(n) => `${n.toFixed(0)}× realtime`} />
        </Text>
        <Text size={28} weight={500} color="#b5afa4" style={{ ...useIn(500), marginTop: 22 * s, maxWidth: 640 * s }}>Apple VideoToolbox · H.265 · AV1 — bitrate-aware, so it never spends more bits than the source.</Text>
      </div>
      <div style={{ position: "absolute", right: -60 * s, bottom: -70 * s, width: Math.min(1040 * s, width * 0.55), transform: `translateX(${(1 - enter) * 220 + pan * s}px) rotate(-3deg)`, transformOrigin: "100% 100%", opacity: Math.min(1, enter * 1.5) }}>
        <MacWindow src="ui/dark.png" dark />
      </div>
    </AbsoluteFill>
  );
};

const Typewriter = ({ text, delayMs }: { text: string; delayMs: number }) => {
  const f = useCurrentFrame();
  const n = Math.max(0, Math.min(text.length, Math.floor((f - ms(delayMs)) / 2)));
  return <>{text.slice(0, n)}<span style={{ opacity: Math.floor(f / 30) % 2 ? 0 : 1 }}>▍</span></>;
};

const Features = () => {
  const s = useScale();
  const feats = [
    { t: "Auto-compress folders", d: "Watch Downloads. New files get lighter on their own — optionally replacing the original.", img: "ui/autocompress.png" },
    { t: "Right-click in Finder", d: "“Compress with Feather” Quick Action, and Open With → Feather.", menu: true },
    { t: "CLI + MCP server", d: "Let Claude or Cursor compress files for you — locally.", code: "feather-cli compress ~/Movies/*.mp4 --max 1920" },
  ];
  return (
    <AbsoluteFill style={{ background: C.paper, padding: `0 ${120 * s}px`, justifyContent: "center" }}>
      <Text size={76} weight={700} style={useIn(0)}>Built for the workflow.</Text>
      <div style={{ display: "flex", gap: 26 * s, marginTop: 52 * s }}>
        {feats.map((ft, i) => (
          <div key={ft.t} style={{ ...useIn(350 + i * 160, 40, 900), flex: 1, background: "#fff", border: `1px solid ${C.stone}`, borderRadius: 22 * s, padding: 32 * s, boxShadow: "0 14px 44px rgba(20,15,5,.06)", display: "flex", flexDirection: "column", gap: 14 * s, minHeight: 470 * s }}>
            <div style={{ width: 46 * s, height: 46 * s, borderRadius: 13 * s, background: C.coral, display: "grid", placeItems: "center", color: "#fff", fontFamily: font, fontWeight: 700, fontSize: 22 * s }}>{i + 1}</div>
            <Text size={34} weight={700}>{ft.t}</Text>
            <Text size={24} weight={500} color={C.ink2}>{ft.d}</Text>
            {ft.code && (
              <div style={{ marginTop: "auto", background: C.black, color: "#fff", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 20 * s, padding: `${14 * s}px ${18 * s}px`, borderRadius: 12 * s, whiteSpace: "nowrap", overflow: "hidden" }}>
                <span style={{ color: C.coral }}>$ </span><Typewriter text={ft.code} delayMs={1300} />
              </div>
            )}
            {ft.img && (
              <div style={{ marginTop: "auto", borderRadius: 12 * s, overflow: "hidden", border: `1px solid ${C.stone}`, height: 200 * s }}>
                <Img src={staticFile(ft.img)} style={{ width: "100%", display: "block" }} />
              </div>
            )}
            {ft.menu && (
              <div style={{ marginTop: "auto", borderRadius: 12 * s, border: `1px solid ${C.stone}`, background: C.paper, padding: 14 * s, fontFamily: font, fontSize: 22 * s, color: C.black }}>
                <div style={{ padding: `${8 * s}px ${12 * s}px`, color: C.ink3 }}>Open With ▸</div>
                <div style={{ padding: `${8 * s}px ${12 * s}px`, borderRadius: 8 * s, background: C.coral, color: "#fff", fontWeight: 600 }}>Compress with Feather</div>
                <div style={{ padding: `${8 * s}px ${12 * s}px`, color: C.ink3 }}>Get Info</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Trust = () => {
  const s = useScale();
  const rows = ["100% on your device — nothing is uploaded", "Open source · MIT · free", "macOS · Apple Silicon & Intel"];
  return (
    <AbsoluteFill style={{ background: C.paper, alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 * s, alignItems: "center" }}>
        {rows.map((r, i) => (
          <div key={r} style={{ ...useIn(i * 220, 24, 800), display: "flex", justifyContent: "center", alignItems: "center", gap: 18 * s }}>
            <Text size={i === 0 ? 66 : 42} weight={i === 0 ? 700 : 500} color={i === 0 ? C.black : C.ink2} align="center">{r}</Text>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const CTA = () => {
  const s = useScale(); const icon = useT(0, 900);
  return (
    <AbsoluteFill style={{ background: C.paper, alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 * s }}>
        <Img src={staticFile("app-icon.png")} style={{ width: 230 * s, height: 230 * s, opacity: icon, transform: `scale(${0.9 + 0.1 * icon})` }} />
        <Text size={84} weight={700} align="center" style={useIn(300)}>Get Feather</Text>
        <Text size={34} weight={500} color={C.ink2} align="center" style={useIn(500)}>github.com/FirasLatrech/feather</Text>
        <div style={{ ...useIn(750), marginTop: 12 * s, background: C.black, color: "#fff", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 23 * s, padding: `${16 * s}px ${24 * s}px`, borderRadius: 14 * s }}>
          <span style={{ color: C.coral }}>$ </span>curl -fsSL https://raw.githubusercontent.com/FirasLatrech/feather/main/install.sh | sh
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ───────────────────────────── timeline ───────────────────────────── */
const T = ms(600);   // cross-dissolve length
const L = { intro: ms(3200), problem: ms(4600), hero: ms(8200), speed: ms(5200), features: ms(6800), trust: ms(4200), cta: ms(5000) };
export const TOTAL_FRAMES = L.intro + L.problem + L.hero + L.speed + L.features + L.trust + L.cta - 6 * T;

export const Trailer = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence durationInFrames={L.intro}><Intro /></TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T, easing: EASE_IO })} />
    <TransitionSeries.Sequence durationInFrames={L.problem}><Problem len={L.problem} /></TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={slide({ direction: "from-bottom" })} timing={linearTiming({ durationInFrames: ms(800), easing: EASE_IO })} />
    <TransitionSeries.Sequence durationInFrames={L.hero}><Hero len={L.hero} /></TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T, easing: EASE_IO })} />
    <TransitionSeries.Sequence durationInFrames={L.speed}><Speed len={L.speed} /></TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T, easing: EASE_IO })} />
    <TransitionSeries.Sequence durationInFrames={L.features}><Features /></TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T, easing: EASE_IO })} />
    <TransitionSeries.Sequence durationInFrames={L.trust}><Trust /></TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T, easing: EASE_IO })} />
    <TransitionSeries.Sequence durationInFrames={L.cta}><CTA /></TransitionSeries.Sequence>
  </TransitionSeries>
);
