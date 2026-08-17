import { chromium } from "playwright-core";
const states = { dark: "?demo=running&theme=dark&gs=1", files: "?demo=files&gs=1&theme=light", running: "?demo=running&gs=1&theme=light", done: "?demo=done&gs=1&theme=light", settings: "?demo=settings&watch=1&theme=light", empty: "?gs=1&theme=light" };
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: "light" });
const page = await ctx.newPage();
for (const [name, q] of Object.entries(states)) {
  await page.goto("http://localhost:1420/" + q, { waitUntil: "networkidle" });
  await page.waitForFunction(() => [...document.querySelectorAll("img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: `../trailer/public/ui/${name}.png` });
  console.log("captured", name);
}
await browser.close();
