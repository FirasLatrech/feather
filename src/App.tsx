import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Feather, Plus } from "lucide-react";
import { useStore } from "./store";
import { CompressView, pickFiles } from "./views/CompressView";
import { HistoryView } from "./views/HistoryView";
import { SettingsView } from "./views/SettingsView";
import "./styles.css";

export default function App() {
  const { ready, init, view, setView, addPaths, setDragging, dragging } = useStore();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
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

  return (
    <div className="app">
      <header className="titlebar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <span className="logo"><Feather size={14} /></span>
          <span data-tauri-drag-region>Feather</span>
        </div>
        <div className="spacer" data-tauri-drag-region />
        <nav className="tabs">
          <button className={view === "compress" ? "active" : ""} onClick={() => setView("compress")}>Compress</button>
          <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>History</button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>Settings</button>
        </nav>
        <button className="icon-btn" title="Add files (⌘O)" onClick={() => pickFiles(addPaths)}><Plus size={16} /></button>
      </header>
      {view === "compress" && <CompressView />}
      {view === "history" && <HistoryView />}
      {view === "settings" && <SettingsView />}
      {dragging && (
        <div className="drop-overlay"><div className="box">Drop to add files</div></div>
      )}
    </div>
  );
}
