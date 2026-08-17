import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { RiAddLine, RiSettings3Line, RiHistoryLine, RiFlashlightLine } from "@remixicon/react";
import { useStore } from "./store";
import { CompressView, pickFiles } from "./views/CompressView";
import { HistoryView } from "./views/HistoryView";
import { SettingsView } from "./views/SettingsView";
import { isTauri } from "./lib/tauri";
import "./styles.css";

export default function App() {
  const { ready, init, view, setView, addPaths, setDragging, dragging } = useStore();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    if (!isTauri) return;
    void getCurrentWebview().onDragDropEvent((e) => {
      const t = e.payload.type;
      if (t === "enter" || t === "over") setDragging(true);
      else if (t === "leave") setDragging(false);
      else if (t === "drop") {
        setDragging(false);
        void addPaths(e.payload.paths);
      }
    }).then((u) => { unlisten = u; });
    return () => unlisten?.();
  }, [addPaths, setDragging]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "o") { e.preventDefault(); void pickFiles(addPaths); }
      if (mod && e.key === "y") { e.preventDefault(); setView("history"); }
      if (mod && e.key === ",") { e.preventDefault(); setView("settings"); }
      if (mod && e.key === "1") { e.preventDefault(); setView("compress"); }
      if (e.key === "Enter" && mod) { e.preventDefault(); void useStore.getState().compress(); }
      if (e.key === "Escape") useStore.getState().select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addPaths, setView]);

  if (!ready) return <div className="app" />;
  const framed = !isTauri && new URLSearchParams(location.search).get("frame");

  const app = (
    <div className={`app${framed ? " framed" : ""}`}>
      {framed && <div className="traffic"><i /><i /><i /></div>}
      <header className="titlebar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <img className="logo" src="/feather-logo.png" alt="" width={24} height={24} draggable={false} />
          <span data-tauri-drag-region>Feather</span>
        </div>
        <nav className="nav">
          <button className={view === "compress" ? "active" : ""} onClick={() => setView("compress")}><RiFlashlightLine size={15} /> Compress</button>
          <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}><RiHistoryLine size={15} /> History</button>
        </nav>
        <div className="right">
          <button className="icon-btn" title="Add files (⌘O)" aria-label="Add files" onClick={() => pickFiles(addPaths)}><RiAddLine size={18} /></button>
          <button className={`icon-btn${view === "settings" ? " active" : ""}`} title="Settings (⌘,)" aria-label="Settings" aria-pressed={view === "settings"} onClick={() => setView(view === "settings" ? "compress" : "settings")} style={view === "settings" ? { background: "var(--bg-sunken)", color: "var(--fg)" } : undefined}><RiSettings3Line size={18} /></button>
        </div>
      </header>
      {view === "compress" && <CompressView />}
      {view === "history" && <div className="main"><HistoryView /></div>}
      {view === "settings" && <div className="main"><SettingsView /></div>}
      {dragging && (
        <div className="drop-overlay"><div className="box"><RiAddLine size={20} /> Drop to add files</div></div>
      )}
    </div>
  );
  return framed ? <div className="desktop">{app}</div> : app;
}
