import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const timingPath = resolve(process.argv[2] || "../deliverables/demo-video/timings.json");
const outputPath = resolve(process.argv[3] || "../deliverables/demo-video/raw/verdictproof-demo.webm");
const metadataPath = resolve(process.argv[4] || "../deliverables/demo-video/raw/recording-metadata.json");
const scenes = JSON.parse(readFileSync(timingPath, "utf8").replace(/^\uFEFF/, ""));
const duration = (id) => Math.max(1, Number(scenes.find((scene) => scene.id === id)?.durationSeconds || 1));
const caption = (id) => scenes.find((scene) => scene.id === id)?.caption || "";
const viewport = { width: 1600, height: 900 };

mkdirSync(dirname(outputPath), { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--hide-scrollbars"] });
const context = await browser.newContext({
  viewport,
  deviceScaleFactor: 1,
  recordVideo: { dir: dirname(outputPath), size: viewport },
});
const startedAt = Date.now();
const page = await context.newPage();
let pointerAnchor = { x: 960, y: 520, width: 80, height: 48 };
const recordedScenes = [];

await page.goto("https://verdictproof.vercel.app/?view=campaigns", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("heading", { name: "Turn product evidence into an on-chain verdict.", exact: true })
  .waitFor({ state: "visible", timeout: 30_000 });
await page.locator("article.campaign-card").first().waitFor({ state: "visible", timeout: 30_000 });
await page.getByRole("status").filter({ hasText: /Loaded 3 live campaigns from Bradbury/ })
  .waitFor({ state: "visible", timeout: 30_000 });
await installRecordingOverlay(page);
const preRollSeconds = (Date.now() - startedAt) / 1000;

await recordScene("intro", () => runTimed(duration("intro"), async () => {
  await showIntro(page, caption("intro"), duration("intro"));
  await wait(page, Math.max(0.5, duration("intro") - 0.5));
  await hideIntro(page);
}));
await recordScene("workflow", () => runWorkflow(page, duration("workflow"), caption("workflow")));
await recordScene("review", () => runReview(page, duration("review"), caption("review")));
await recordScene("dashboard", () => runDashboard(page, duration("dashboard"), caption("dashboard")));
await recordScene("approved", () => runApproved(page, duration("approved"), caption("approved")));
await recordScene("consensus", () => runConsensus(page, duration("consensus"), caption("consensus")));
await recordScene("rejections", () => runRejections(page, duration("rejections"), caption("rejections")));
await recordScene("settlement", () => runSettlement(page, duration("settlement"), caption("settlement")));

const video = page.video();
await page.close();
await context.close();
if (!video) throw new Error("Playwright did not create a recording");
await video.saveAs(outputPath);
await browser.close();
writeFileSync(metadataPath, JSON.stringify({
  preRollSeconds,
  sceneDurationSeconds: recordedScenes.reduce((sum, scene) => sum + scene.durationSeconds, 0),
  scenes: recordedScenes,
}, null, 2));
console.log(`DEMO_RECORDING_OK video=${outputPath} metadata=${metadataPath}`);

async function installRecordingOverlay(target) {
  await target.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = `
      html { scroll-behavior: auto !important; }
      #vp-demo-caption { position: fixed; left: 50%; bottom: 30px; z-index: 2147483646; transform: translateX(-50%) translateY(16px); width: min(1040px, calc(100vw - 120px)); padding: 15px 24px; overflow: hidden; color: #f7fbff; background: rgba(10,15,32,.94); border: 1px solid rgba(116,221,200,.28); border-radius: 14px; box-shadow: 0 18px 48px rgba(0,0,0,.32); font: 700 22px/1.35 Arial, sans-serif; text-align: center; opacity: 0; transition: opacity .28s ease, transform .28s ease; pointer-events: none; }
      #vp-demo-caption.visible { opacity: 1; transform: translateX(-50%) translateY(0); }
      #vp-demo-caption::after { content: ""; position: absolute; left: 0; bottom: 0; width: 100%; height: 4px; background: linear-gradient(90deg,#74ddc8,#9b7cff); transform: scaleX(0); transform-origin: left center; }
      #vp-demo-caption.visible::after { animation: vp-demo-progress var(--scene-duration, 10s) linear forwards; }
      #vp-demo-cursor { position: fixed; left: -100px; top: -100px; z-index: 2147483647; width: 30px; height: 39px; background: no-repeat center/contain url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='30' height='39' viewBox='0 0 30 39'%3E%3Cpath d='M3 2.5v27.2l7-6.6 5.3 12 5.4-2.4-5.2-11.7h9.9L3 2.5Z' fill='%23fff' stroke='%23070d18' stroke-width='2.3' stroke-linejoin='round'/%3E%3C/svg%3E"); filter: drop-shadow(0 3px 4px rgba(0,0,0,.5)); pointer-events: none; transform-origin: 3px 3px; transition: transform .12s ease, opacity .2s ease; }
      #vp-demo-intro { position: fixed; inset: 0; z-index: 2147483645; display: grid; place-items: center; color: #fff; background: radial-gradient(circle at 25% 20%,rgba(116,221,200,.18),transparent 34%),radial-gradient(circle at 78% 65%,rgba(155,124,255,.2),transparent 36%),rgba(6,10,24,.94); backdrop-filter: blur(8px); opacity: 0; transition: opacity .35s ease; pointer-events: none; }
      #vp-demo-intro.visible { opacity: 1; }
      #vp-demo-intro .inner { width: min(1100px, calc(100vw - 180px)); text-align: center; }
      #vp-demo-intro img { width: 82px; height: 82px; margin-bottom: 22px; }
      #vp-demo-intro h2 { margin: 0 0 18px; color: #fff; font: 800 72px/1.05 Arial, sans-serif; letter-spacing: -2px; }
      #vp-demo-intro p { margin: 0 auto; max-width: 980px; color: #dfe8ff; font: 500 30px/1.4 Arial, sans-serif; }
      #vp-demo-intro .proof { margin-top: 30px; color: #74ddc8; font: 700 18px/1.4 Arial, sans-serif; text-transform: uppercase; letter-spacing: 1px; }
      #vp-demo-intro .proof::after { content: ""; display: block; width: 420px; max-width: 70vw; height: 3px; margin: 18px auto 0; background: linear-gradient(90deg,#74ddc8,#9b7cff); transform: scaleX(0); transform-origin: left center; }
      #vp-demo-intro.visible .proof::after { animation: vp-demo-progress var(--scene-duration, 10s) linear forwards; }
      @keyframes vp-demo-progress { to { transform: scaleX(1); } }
    `;
    document.head.append(style);
    const captionNode = document.createElement("div");
    captionNode.id = "vp-demo-caption";
    const cursor = document.createElement("div");
    cursor.id = "vp-demo-cursor";
    const intro = document.createElement("div");
    intro.id = "vp-demo-intro";
    intro.innerHTML = '<div class="inner"><img src="/assets/verdictproof-mark.svg" alt=""><h2>VerdictProof</h2><p></p><div class="proof">Live on GenLayer Bradbury</div></div>';
    document.body.append(captionNode, cursor, intro);
    document.addEventListener("mousemove", (event) => {
      cursor.style.left = `${event.clientX}px`;
      cursor.style.top = `${event.clientY}px`;
    });
    document.addEventListener("mousedown", () => { cursor.style.transform = "scale(.72)"; });
    document.addEventListener("mouseup", () => { cursor.style.transform = "scale(1)"; });
  });
}

async function setCaption(target, text, seconds) {
  await target.evaluate(({ value, durationSeconds }) => {
    const node = document.querySelector("#vp-demo-caption");
    if (!node) return;
    node.classList.remove("visible");
    node.textContent = value;
    node.style.setProperty("--scene-duration", `${durationSeconds}s`);
    void node.offsetWidth;
    node.classList.add("visible");
  }, { value: text, durationSeconds: seconds });
}

async function hideCaption(target) {
  await target.evaluate(() => document.querySelector("#vp-demo-caption")?.classList.remove("visible"));
  await target.waitForTimeout(220);
}

async function showIntro(target, text, seconds, closing = false) {
  await target.evaluate(({ value, durationSeconds, isClosing }) => {
    const intro = document.querySelector("#vp-demo-intro");
    if (!intro) return;
    intro.classList.remove("visible");
    document.querySelector("#vp-demo-caption")?.classList.remove("visible");
    const cursor = document.querySelector("#vp-demo-cursor");
    if (cursor) cursor.style.opacity = "0";
    const paragraph = intro.querySelector("p");
    if (paragraph) paragraph.textContent = value;
    const proof = intro.querySelector(".proof");
    if (proof) proof.textContent = isClosing
      ? "verdictproof.vercel.app  |  github.com/tanphung/VerdictProof"
      : "Live on GenLayer Bradbury";
    intro.style.setProperty("--scene-duration", `${durationSeconds}s`);
    void intro.offsetWidth;
    intro.classList.add("visible");
  }, { value: text, durationSeconds: seconds, isClosing: closing });
}

async function hideIntro(target) {
  await target.evaluate(() => {
    document.querySelector("#vp-demo-intro")?.classList.remove("visible");
    const cursor = document.querySelector("#vp-demo-cursor");
    if (cursor) cursor.style.opacity = "1";
  });
  await target.waitForTimeout(450);
}

async function slowScrollTo(target, locator, blockOffset = 150) {
  const targetY = await locator.evaluate((element, offset) => {
    const rect = element.getBoundingClientRect();
    return Math.max(0, window.scrollY + rect.top - offset);
  }, blockOffset);
  const startY = await target.evaluate(() => window.scrollY);
  const distance = targetY - startY;
  const steps = Math.max(10, Math.min(32, Math.ceil(Math.abs(distance) / 75)));
  await target.mouse.move(viewport.width - 80, viewport.height / 2, { steps: 18 });
  for (let index = 0; index < steps; index += 1) {
    await target.mouse.wheel(0, distance / steps);
    await target.waitForTimeout(34);
  }
  await target.waitForTimeout(300);
}

async function click(target, locator) {
  await slowScrollTo(target, locator, 260);
  const box = await locator.boundingBox();
  if (!box) throw new Error("Demo target is not visible");
  pointerAnchor = box;
  await target.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 30 });
  await target.waitForTimeout(260);
  await locator.click();
  await target.waitForTimeout(420);
}

async function point(target, locator, offset = 230) {
  await slowScrollTo(target, locator, offset);
  const box = await locator.boundingBox();
  if (!box) return;
  pointerAnchor = box;
  await target.mouse.move(box.x + Math.min(box.width * 0.56, box.width - 14), box.y + Math.min(box.height * 0.45, box.height - 12), { steps: 32 });
}

async function wait(target, seconds) {
  const deadline = Date.now() + Math.max(250, seconds * 1_000);
  const offsets = [[.42,.48],[.58,.43],[.62,.58],[.46,.62]];
  let index = 0;
  while (Date.now() < deadline) {
    const [xRatio, yRatio] = offsets[index % offsets.length];
    const x = Math.max(28, Math.min(viewport.width - 30, pointerAnchor.x + pointerAnchor.width * xRatio));
    const y = Math.max(28, Math.min(viewport.height - 40, pointerAnchor.y + pointerAnchor.height * yRatio));
    await target.mouse.move(x, y, { steps: 14 });
    const remaining = deadline - Date.now();
    if (remaining > 0) await target.waitForTimeout(Math.min(260, remaining));
    index += 1;
  }
}

async function runTimed(seconds, action) {
  const started = Date.now();
  await action();
  const remaining = seconds * 1_000 - (Date.now() - started);
  if (remaining > 0) await page.waitForTimeout(remaining);
}

async function recordScene(id, action) {
  const started = Date.now();
  await action();
  recordedScenes.push({ id, durationSeconds: (Date.now() - started) / 1_000 });
}

async function openReport(target, submissionId) {
  const article = target.locator(`#submission-${submissionId}`);
  await slowScrollTo(target, article, 170);
  const details = article.locator("details.full-consensus-report");
  if (!(await details.getAttribute("open"))) {
    await click(target, details.locator("summary"));
  } else {
    await point(target, details.locator("summary"));
  }
  return { article, details };
}

async function runWorkflow(target, seconds, text) {
  await runTimed(seconds, async () => {
    await setCaption(target, text, seconds);
    await point(target, target.getByRole("heading", { name: "Turn product evidence into an on-chain verdict.", exact: true }), 180);
    await wait(target, seconds * .13);
    await point(target, target.locator(".protocol-stats"));
    await wait(target, seconds * .11);
    const campaign = target.locator("article.campaign-card").first();
    await point(target, campaign);
    await wait(target, seconds * .14);
    await click(target, campaign.getByRole("button", { name: "Open Campaign", exact: true }));
    await point(target, target.locator(".detail-panel .campaign-brief"));
    await wait(target, seconds * .11);
    await point(target, target.locator(".detail-panel .requirement-box"));
  });
}

async function runReview(target, seconds, text) {
  await runTimed(seconds, async () => {
    await hideCaption(target);
    await click(target, target.getByRole("button", { name: "Review", exact: true }));
    const heading = target.getByRole("heading", { name: "Judge pending product feedback.", exact: true });
    await heading.waitFor({ state: "visible" });
    await setCaption(target, text, seconds);
    await point(target, heading, 150);
    await wait(target, seconds * .08);
    await point(target, target.locator(".review-view-grid .detail-panel"));
    await wait(target, seconds * .08);
    const lifecycle = target.locator(".lifecycle-section");
    await point(target, lifecycle, 150);
    const cards = lifecycle.locator(".lifecycle-grid > *");
    for (let index = 0; index < await cards.count(); index += 1) {
      await point(target, cards.nth(index), 210);
      await wait(target, seconds * .03);
    }
  });
}

async function runDashboard(target, seconds, text) {
  await runTimed(seconds, async () => {
    await hideCaption(target);
    await click(target, target.getByRole("button", { name: "Dashboard", exact: true }));
    await target.getByRole("heading", { name: "AI verdict history and protocol health.", exact: true }).waitFor({ state: "visible" });
    await setCaption(target, text, seconds);
    await point(target, target.getByRole("heading", { name: "AI verdict history and protocol health.", exact: true }), 170);
    await wait(target, seconds * .12);
    await point(target, target.locator(".signal-health"));
    await wait(target, seconds * .12);
    await point(target, target.locator(".review-history"));
    await wait(target, seconds * .12);
    await point(target, target.locator("#submission-1-1"));
  });
}

async function runApproved(target, seconds, text) {
  await runTimed(seconds, async () => {
    await hideCaption(target);
    const { details } = await openReport(target, "1-1");
    await setCaption(target, text, seconds);
    await point(target, details.locator(".report-provenance"));
    await wait(target, seconds * .06);
    await point(target, details.locator(".report-context"));
    await wait(target, seconds * .06);
    await point(target, details.locator(".verification-grid"));
    await wait(target, seconds * .10);
    await point(target, details.locator(".detailed-rubric"));
    await wait(target, seconds * .12);
    await point(target, details.locator(".evidence-links-panel"));
    await wait(target, seconds * .05);
    await point(target, details.locator(".review-detail-grid"));
  });
}

async function runConsensus(target, seconds, text) {
  await runTimed(seconds, async () => {
    await hideCaption(target);
    const details = target.locator("#submission-1-1 details.full-consensus-report");
    await setCaption(target, text, seconds);
    const proof = details.locator(".consensus-proof");
    await point(target, proof);
    await wait(target, seconds * .13);
    const metrics = proof.locator(".consensus-metrics > *");
    for (let index = 0; index < await metrics.count(); index += 1) {
      await point(target, metrics.nth(index));
      await wait(target, seconds * .065);
    }
    await point(target, details.locator(".report-provenance"));
    await wait(target, seconds * .12);
    await point(target, proof.getByRole("link", { name: /Verify review transaction/ }));
  });
}

async function runRejections(target, seconds, text) {
  await runTimed(seconds, async () => {
    await hideCaption(target);
    const identity = await openReport(target, "1-2");
    await setCaption(target, text, seconds);
    await point(target, identity.article.locator(".reason"));
    await wait(target, seconds * .07);
    await point(target, identity.details.locator(".verification-grid"));
    await wait(target, seconds * .10);
    const semantic = await openReport(target, "1-3");
    await point(target, semantic.article.locator(".reason"));
    await wait(target, seconds * .07);
    await point(target, semantic.details.locator(".verification-grid"));
    await wait(target, seconds * .10);
    await point(target, semantic.details.locator(".detailed-rubric"));
  });
}

async function runSettlement(target, seconds, text) {
  await runTimed(seconds, async () => {
    await hideCaption(target);
    await click(target, target.getByRole("button", { name: "Claims", exact: true }));
    const claimsHeading = target.getByRole("heading", { name: "Rewards, stake returns, and slashes.", exact: true });
    await claimsHeading.waitFor({ state: "visible" });
    await setCaption(target, text, seconds * .36);
    await point(target, claimsHeading, 160);
    await wait(target, seconds * .10);
    await point(target, target.locator(".claim-console"), 170);
    await wait(target, seconds * .08);
    await click(target, target.getByRole("button", { name: "Campaigns", exact: true }));
    await setCaption(target, text, seconds * .46);
    await point(target, target.locator("article.campaign-card").filter({ hasText: "CLOSED" }).first());
    await wait(target, seconds * .10);
    const claimed = target.locator("article.submission-row").filter({ hasText: "CLAIMED" }).first();
    await point(target, claimed);
    await wait(target, seconds * .10);
    await hideCaption(target);
    await showIntro(target, text, seconds * .28, true);
    await wait(target, seconds * .24);
  });
}
