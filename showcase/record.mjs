// Records a guided product tour of Feather (browser preview with mocked backend) to WebM,
// with a synthetic cursor + step captions. Convert to GIF/MP4 with ./encode.sh.
import { chromium } from "playwright-core";
import fs from "node:fs";

const W = 1440, H = 900;
const OUT = "rec";
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT);

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--force-device-scale-factor=1"] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, recordVideo: { dir: OUT, size: { width: W, height: H } }, colorScheme: "light" });
const page = await ctx.newPage();
await page.goto("http://localhost:1420/?gs=1&frame=1", { waitUntil: "networkidle" });

// ── overlay: cursor + caption ─────────────────────────────────────────────
await page.addStyleTag({ content: `
  #cur { position: fixed; z-index: 99999; width: 22px; height: 30px; pointer-events: none; transform: translate(-3px,-2px); filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); transition: left .55s cubic-bezier(.2,.8,.2,1), top .55s cubic-bezier(.2,.8,.2,1); }
  #cur.click { animation: clk .28s ease-out; }
  @keyframes clk { 0% { transform: translate(-3px,-2px) scale(1);} 40% { transform: translate(-3px,-2px) scale(.8);} 100% { transform: translate(-3px,-2px) scale(1);} }
  #cap { position: fixed; z-index: 99998; left: 50%; bottom: 22px; transform: translateX(-50%) translateY(20px); opacity: 0; transition: opacity .35s, transform .35s cubic-bezier(.2,.8,.2,1); background: rgba(17,17,17,.92); backdrop-filter: blur(8px); color: #fff; font: 600 17px/1.3 "Geist Variable", -apple-system, system-ui, sans-serif; padding: 12px 18px; border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.25); display: flex; align-items: center; gap: 12px; max-width: 720px; pointer-events: none; }
  #cap.on { opacity: 1; transform: translateX(-50%) translateY(0); }
  #cap b { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 999px; background: #F95C4B; font-size: 13px; flex-shrink: 0; }
`});
await page.evaluate(() => {
  const c = document.createElement("div"); c.id = "cur";
  c.innerHTML = `<svg viewBox="0 0 22 30" width="22" height="30"><path d="M2 2 L2 24 L8 18 L12 28 L16 26 L12 17 L20 17 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  c.style.left = "640px"; c.style.top = "400px"; document.body.appendChild(c);
  const cap = document.createElement("div"); cap.id = "cap"; document.body.appendChild(cap);
});
const sleep = (ms) => page.waitForTimeout(ms);
const caption = async (n, text) => { await page.evaluate(([n, t]) => { const c = document.getElementById("cap"); c.innerHTML = `<b>${n}</b><span>${t}</span>`; c.classList.add("on"); }, [n, text]); };
const captionOff = async () => page.evaluate(() => document.getElementById("cap").classList.remove("on"));
const moveTo = async (x, y) => { await page.evaluate(([x, y]) => { const c = document.getElementById("cur"); c.style.left = x + "px"; c.style.top = y + "px"; }, [x, y]); await sleep(650); };
const clickSel = async (sel, opts = {}) => {
  const el = page.locator(sel).first(); await el.waitFor({ state: "visible" });
  const b = await el.boundingBox(); const x = b.x + b.width * (opts.fx ?? 0.5), y = b.y + b.height * (opts.fy ?? 0.5);
  await moveTo(x, y);
  await page.evaluate(() => { const c = document.getElementById("cur"); c.classList.remove("click"); void c.offsetWidth; c.classList.add("click"); });
  await el.click(); await sleep(opts.after ?? 700);
};

// ── the tour ──────────────────────────────────────────────────────────────
// warm the image cache so thumbnails appear instantly
await page.evaluate(() => Promise.all([1011,1015,180,0,1043,1025].map((id) => new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = `https://picsum.photos/id/${id}/640/400`; }))));
await sleep(600);
await caption(1, "Add files — or just drop them anywhere");
await clickSel("button:has-text('Add files')", { after: 600 });
await page.waitForFunction(() => { const imgs = [...document.querySelectorAll(".card .thumb img")]; return imgs.length >= 6 && imgs.every((i) => i.complete && i.naturalWidth > 0); }, null, { timeout: 20000 }).catch(() => {});
await sleep(900);
await caption(2, "Every file shows an estimate before you compress");
await sleep(1600);
await caption(3, "Pick a quality — that's usually all you need");
await clickSel(".quality .steps button:has-text('Medium')", { after: 900 });
await clickSel(".quality .steps button:has-text('Good')", { after: 700 });
await caption(4, "Resize with one dropdown · formats · remove audio");
await clickSel(".sidebar select.select", { after: 400 });
await page.selectOption(".sidebar select.select", "1920"); await sleep(900);
await caption(5, "Click a file to give it its own settings");
await clickSel(".card >> nth=1", { after: 900 });
await clickSel(".sidebar .quality .steps button:has-text('High')", { after: 900 });
await clickSel(".sidebar-head .icon-btn", { after: 700 });
await caption(6, "Compress — hardware-accelerated, with live speed and ETA");
await clickSel(".actionbar .btn.primary", { after: 4200 });
await sleep(1500);
await caption(7, "See what you saved · open or reveal the result");
await sleep(1800);
await caption(8, "Settings → Auto-compress: watch Downloads, replace originals");
await clickSel("button[aria-label='Settings']", { after: 900 });
await page.locator(".section-title:has-text('Auto-compress')").scrollIntoViewIfNeeded(); await sleep(600);
await clickSel(".panel .toggle >> nth=0", { after: 900 });   // Watch folders
await clickSel("button:has-text('Add Downloads')", { after: 1200 });
await clickSel("button:has-text('Replace the original file') >> xpath=..//button[contains(@class,'toggle')]", { after: 1400 }).catch(async () => { await clickSel(".panel .toggle >> nth=1", { after: 1400 }); });
await caption(9, "Finder Quick Action · CLI + MCP for AI agents");
await page.evaluate(() => { const el = [...document.querySelectorAll(".section-title")].find((e) => e.textContent?.includes("Finder")); el?.scrollIntoView({ behavior: "smooth", block: "start" }); }); await sleep(1600);
await page.evaluate(() => { const el = [...document.querySelectorAll(".section-title")].find((e) => e.textContent?.includes("MCP")); el?.scrollIntoView({ behavior: "smooth", block: "start" }); }); await sleep(1800);
await caption(10, "History — everything you've saved");
await clickSel(".nav button:has-text('History')", { after: 1800 });
await captionOff(); await sleep(400);
await caption(0, "Feather · 100% on-device · open source · github.com/FirasLatrech/feather");
await sleep(2200);
await ctx.close(); await browser.close();
const files = fs.readdirSync(OUT).filter((f) => f.endsWith(".webm"));
fs.renameSync(`${OUT}/${files[0]}`, `${OUT}/tour.webm`);
console.log("recorded rec/tour.webm");
