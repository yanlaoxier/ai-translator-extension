import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const userDataDir = path.join(root, "tmp-chrome-profile");
const screenshotDir = path.join(root, "test-results");

const apiKey = process.env.KELI_API_KEY;
const baseUrl = process.env.KELI_BASE_URL || "https://api.deepseek.com";
const model = process.env.KELI_MODEL || "deepseek-v4-flash";

if (!apiKey) {
  throw new Error("缺少 KELI_API_KEY");
}

function waitForServer(url, timeoutMs = 10_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const ping = () => {
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on("error", (error) => {
          if (Date.now() - start > timeoutMs) reject(error);
          else setTimeout(ping, 200);
        });
    };
    ping();
  });
}

async function main() {
  await fs.mkdir(screenshotDir, { recursive: true });
  await fs.rm(userDataDir, { recursive: true, force: true });

  const server = spawn("python", ["-m", "http.server", "8765", "--bind", "127.0.0.1"], {
    cwd: path.join(root, "test"),
    stdio: "ignore",
    windowsHide: true,
  });

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chrome",
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      "--enable-unsafe-extension-debugging",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  try {
    await waitForServer("http://127.0.0.1:8765/sample.html");

    const page0 = context.pages()[0] || (await context.newPage());
    const browser = context.browser();
    const cdp = browser?.newBrowserCDPSession
      ? await browser.newBrowserCDPSession()
      : await context.newCDPSession(page0);
    const loaded = await cdp.send("Extensions.loadUnpacked", { path: root });
    console.log("loaded extension", loaded);

    let worker = context.serviceWorkers()[0];
    if (!worker) {
      try {
        worker = await context.waitForEvent("serviceworker", { timeout: 30_000 });
      } catch (error) {
        console.log("pages", context.pages().map((page) => page.url()));
        console.log("workers", context.serviceWorkers().map((item) => item.url()));
        throw error;
      }
    }
    const extensionId = loaded?.id || new URL(worker.url()).host;
    console.log("extension id:", extensionId);

    await worker.evaluate(async ({ apiKey, baseUrl, model }) => {
      await chrome.storage.local.set({
        apiKey,
        baseUrl,
        model,
        targetLang: "zh",
        bilingual: true,
      });
    }, { apiKey, baseUrl, model });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForSelector("#apiKey");
    await popup.fill("#apiKey", apiKey);
    await popup.fill("#baseUrl", baseUrl);
    await popup.fill("#model", model);
    await popup.click("#btn-save");
    await popup.click("#btn-test");
    await popup.waitForFunction(
      () => document.getElementById("conn-pill")?.textContent?.includes("已连接"),
      null,
      { timeout: 40_000 },
    );
    await popup.screenshot({ path: path.join(screenshotDir, "popup-connected.png") });
    console.log("popup connection: ok");

    const page = await context.newPage();
    await page.goto("http://127.0.0.1:8765/sample.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url && item.url.includes("8765/sample.html"));
      if (!tab?.id) throw new Error("test page tab not found");
      const response = await chrome.tabs.sendMessage(tab.id, { type: "KELI_TRANSLATE_PAGE" });
      if (response && response.ok === false) throw new Error(response.error || "translate failed");
    });

    await page.waitForFunction(
      () => document.querySelectorAll(".keli-t, .keli-pair").length > 0,
      null,
      { timeout: 90_000 },
    );
    const translatedCount = await page.locator(".keli-t, .keli-pair").count();
    await page.screenshot({ path: path.join(screenshotDir, "page-translated.png"), fullPage: true });
    console.log("page translation nodes:", translatedCount);

    await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url && item.url.includes("8765/sample.html"));
      await chrome.tabs.sendMessage(tab.id, { type: "KELI_RESTORE_PAGE" });
    });
    await page.waitForFunction(() => document.querySelectorAll(".keli-t, .keli-pair").length === 0);
    console.log("restore: ok");

    await page.locator("#lead").evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: rect.left + 40,
          clientY: rect.bottom,
        }),
      );
    });
    await page.waitForFunction(() => {
      const chip = document.getElementById("keli-host")?.shadowRoot?.querySelector(".chip");
      return chip && !chip.hidden;
    });
    await page.evaluate(() => {
      document.getElementById("keli-host").shadowRoot.querySelector(".chip").click();
    });
    await page.waitForFunction(() => {
      const dst = document.getElementById("keli-host")?.shadowRoot?.querySelector(".dst");
      return dst && dst.textContent && dst.textContent.trim().length > 0;
    }, null, { timeout: 40_000 });
    const selectionText = await page.evaluate(
      () => document.getElementById("keli-host").shadowRoot.querySelector(".dst").textContent,
    );
    await page.screenshot({ path: path.join(screenshotDir, "selection.png") });
    console.log("selection translation:", selectionText);

    await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url && item.url.includes("8765/sample.html"));
      const response = await chrome.tabs.sendMessage(tab.id, { type: "KELI_SUMMARIZE_PAGE" });
      if (response && response.ok === false) throw new Error(response.error || "summarize failed");
    });
    await page.waitForFunction(() => {
      const summary = document.getElementById("keli-host")?.shadowRoot?.querySelector(".summary");
      return summary && summary.textContent && summary.textContent.trim().length > 10;
    }, null, { timeout: 90_000 });
    const summaryText = await page.evaluate(
      () => document.getElementById("keli-host").shadowRoot.querySelector(".summary").textContent,
    );
    await page.screenshot({ path: path.join(screenshotDir, "summary.png") });
    console.log("summary:", summaryText.slice(0, 160));

    if (translatedCount < 1 || !/[\u4e00-\u9fff]/.test(selectionText) || summaryText.trim().length < 10) {
      throw new Error("feature assertions failed");
    }
    console.log("extension e2e passed");
  } finally {
    await context.close();
    server.kill();
  }
}

main().catch(async (error) => {
  console.error("e2e failed:", error);
  process.exit(1);
});
