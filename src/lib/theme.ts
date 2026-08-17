export type Theme = "light" | "dark" | "system";
const KEY = "feather.theme";
export function getTheme(): Theme {
  const q = new URLSearchParams(location.search).get("theme");
  if (q === "light" || q === "dark" || q === "system") return q;
  const v = localStorage.getItem(KEY);
  return v === "dark" || v === "system" ? v : "light";
}
const mq = window.matchMedia("(prefers-color-scheme: dark)");
export function applyTheme(t: Theme) {
  localStorage.setItem(KEY, t);
  const root = document.documentElement;
  root.dataset.theme = t;
  root.classList.toggle("sys-dark", t === "system" && mq.matches);
}
mq.addEventListener("change", () => applyTheme(getTheme()));
applyTheme(getTheme());
