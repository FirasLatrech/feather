import type { Resize, ResizeMode } from "../lib/types";
import { Field } from "./Controls";

const MODES: { value: ResizeMode; label: string }[] = [
  { value: "none", label: "Original" },
  { value: "width", label: "Max width" },
  { value: "height", label: "Max height" },
  { value: "longedge", label: "Long edge" },
  { value: "shortedge", label: "Short edge" },
  { value: "percent", label: "Percent" },
];

export function ResizeControl({ value, onChange, presets }: { value: Resize; onChange: (r: Resize) => void; presets?: number[] }) {
  const p = presets ?? [3840, 2560, 1920, 1280, 1080, 720, 480];
  return (
    <Field label="Resize" hint="Never upscales · aspect ratio kept">
      <div className="inline" style={{ gap: 8 }}>
        <select className="select" value={value.mode} onChange={(e) => onChange({ mode: e.target.value as ResizeMode, value: value.value || (e.target.value === "percent" ? 50 : 1920) })}>
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        {value.mode !== "none" && (
          <>
            <input
              className="input sm"
              type="number"
              min={1}
              value={value.value || ""}
              onChange={(e) => onChange({ ...value, value: Number(e.target.value) || 0 })}
              list={value.mode === "percent" ? undefined : "resize-presets"}
            />
            <small style={{ color: "var(--fg-3)" }}>{value.mode === "percent" ? "%" : "px"}</small>
            <datalist id="resize-presets">
              {p.map((v) => <option key={v} value={v} />)}
            </datalist>
          </>
        )}
      </div>
    </Field>
  );
}
