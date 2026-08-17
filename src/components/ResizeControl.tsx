import type { Resize } from "../lib/types";
import { Field } from "./Controls";

const PRESETS: { label: string; value: number }[] = [
  { label: "Original size", value: 0 },
  { label: "4K · 3840 px", value: 3840 },
  { label: "1440p · 2560 px", value: 2560 },
  { label: "1080p · 1920 px", value: 1920 },
  { label: "720p · 1280 px", value: 1280 },
  { label: "480p · 854 px", value: 854 },
  { label: "Small · 640 px", value: 640 },
];

/** Simple resize: one dropdown of long-edge presets. Never upscales, keeps aspect ratio. */
export function ResizeControl({ value, onChange, presets, label = "Resize" }: { value: Resize; onChange: (r: Resize) => void; presets?: number[]; label?: string }) {
  const list = presets ? [PRESETS[0], ...PRESETS.filter((p) => presets.includes(p.value))] : PRESETS;
  const isPreset = value.mode === "none" || (value.mode === "longedge" && list.some((p) => p.value === value.value));
  return (
    <Field label={label} hint="Longest side · never upscales">
      <select
        className="select"
        value={isPreset ? (value.mode === "none" ? 0 : value.value) : "custom"}
        onChange={(e) => {
          const v = Number(e.target.value);
          onChange(v === 0 ? { mode: "none", value: 0 } : { mode: "longedge", value: v });
        }}
      >
        {list.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        {!isPreset && <option value="custom">Custom · {value.value}{value.mode === "percent" ? "%" : " px"} ({value.mode})</option>}
      </select>
    </Field>
  );
}
