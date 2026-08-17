import { useState, type ReactNode } from "react";
import { RiArrowDownSLine } from "@remixicon/react";
import { QUALITIES, type Quality } from "../lib/types";

export function Field({ label, hint, children, row, right }: { label: string; hint?: string; children?: ReactNode; row?: boolean; right?: ReactNode }) {
  return (
    <div className={`field${row ? " row" : ""}`}>
      <div className="label">
        <span>{label}</span>
        {row && hint ? <span className="hint">{hint}</span> : right}
      </div>
      {children}
      {!row && hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Group({ icon, title, summary, children, defaultOpen = true }: { icon: ReactNode; title: string; summary?: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`group${open ? " open" : ""}`}>
      <button className="group-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="gi">{icon}</span>
        {title}
        {!open && summary && <span className="summary">{summary}</span>}
        <RiArrowDownSLine size={16} className="chev" style={{ marginLeft: open || !summary ? "auto" : 8 }} aria-hidden />
      </button>
      {open && <div className="group-body">{children}</div>}
    </section>
  );
}

export function Segmented<T extends string>({ value, options, onChange, compact }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; compact?: boolean }) {
  return (
    <div className={`segmented${compact ? " compact" : ""}`}>
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? "active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button className={`toggle${value ? " on" : ""}`} onClick={() => onChange(!value)} role="switch" aria-checked={value} aria-label={label} />;
}

export function QualityPicker({ value, onChange }: { value: Quality; onChange: (q: Quality) => void }) {
  const cur = QUALITIES.find((q) => q.value === value) ?? QUALITIES[2];
  return (
    <div className="quality">
      <div className="steps">
        {QUALITIES.map((q) => (
          <button key={q.value} className={q.value === value ? "active" : ""} onClick={() => onChange(q.value)} title={q.hint}>{q.label}</button>
        ))}
      </div>
      <div className="desc"><span><b>{cur.label}</b> · {cur.hint}</span><span>{value === "highest" ? "larger file" : value === "acceptable" ? "smallest file" : ""}</span></div>
    </div>
  );
}

export function NumberInput({ value, onChange, min, max, step, placeholder, suffix }: { value: number | null; onChange: (v: number | null) => void; min?: number; max?: number; step?: number; placeholder?: string; suffix?: string }) {
  return (
    <span className="inline">
      <input
        className="input sm"
        type="number"
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? null : Number(v));
        }}
      />
      {suffix && <small style={{ color: "var(--fg-3)", minWidth: 22 }}>{suffix}</small>}
    </span>
  );
}

/** Small disclosure for power-user options; collapsed by default. */
export function Advanced({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="advanced">
      <button className="advanced-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <RiArrowDownSLine size={14} className="chev" style={{ transform: open ? "rotate(180deg)" : undefined }} aria-hidden /> Advanced
      </button>
      {open && <div className="advanced-body">{children}</div>}
    </div>
  );
}
