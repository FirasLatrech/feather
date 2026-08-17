/** True when running inside the Tauri webview; false in a plain browser (mock/dev-preview mode). */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
