import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sandbox = { console, fetch, AbortController, setTimeout, clearTimeout };
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "lib/api.js"), "utf8"), sandbox);

const {
  chatCompletions,
  completionsEndpoint,
  extractJsonArray,
  buildTranslateMessages,
  buildSummarizeMessages,
} = sandbox.KeliApi;

const apiKey = process.env.KELI_API_KEY;
const baseUrl = process.env.KELI_BASE_URL || "https://api.deepseek.com";
const model = process.env.KELI_MODEL || "deepseek-v4-flash";

if (!apiKey) {
  throw new Error("缺少 KELI_API_KEY");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function testHelpers() {
  assert(
    completionsEndpoint("https://api.deepseek.com") === "https://api.deepseek.com/chat/completions",
    "DeepSeek official path should be /chat/completions",
  );
  assert(
    completionsEndpoint("https://api.deepseek.com/v1/") === "https://api.deepseek.com/v1/chat/completions",
    "base url ending with /v1 should work",
  );
  assert(
    completionsEndpoint("https://api.openai.com") === "https://api.openai.com/v1/chat/completions",
    "generic OpenAI-compatible hosts should use /v1",
  );
  assert(
    JSON.stringify(extractJsonArray('```json\n["你好","世界"]\n```')) === JSON.stringify(["你好", "世界"]),
    "fenced json array should parse",
  );
  console.log("helper tests passed");
}

async function run() {
  testHelpers();

  const ping = await chatCompletions({
    apiKey,
    baseUrl,
    model,
    temperature: 0,
    timeoutMs: 30_000,
    messages: [{ role: "user", content: 'Reply with the exact word "OK" and nothing else.' }],
  });
  console.log("connection reply:", ping.text.trim());
  assert(/ok/i.test(ping.text), `unexpected ping reply: ${ping.text}`);

  const zh = await chatCompletions({
    apiKey,
    baseUrl,
    model,
    temperature: 0.1,
    messages: buildTranslateMessages(["Hello, world. This is a translation plugin."], "zh"),
  });
  const zhArr = extractJsonArray(zh.text);
  console.log("en->zh:", zhArr[0]);
  assert(zhArr.length === 1 && /[\u4e00-\u9fff]/.test(zhArr[0]), "English should translate into Chinese");

  const en = await chatCompletions({
    apiKey,
    baseUrl,
    model,
    temperature: 0.1,
    messages: buildTranslateMessages(["划词翻译应当在选中文字后出现译文。"], "en"),
  });
  const enArr = extractJsonArray(en.text);
  console.log("zh->en:", enArr[0]);
  assert(enArr.length === 1 && /[A-Za-z]/.test(enArr[0]), "Chinese should translate into English");

  const summary = await chatCompletions({
    apiKey,
    baseUrl,
    model,
    temperature: 0.2,
    messages: buildSummarizeMessages(
      {
        title: "课利译功能测试页",
        url: "http://127.0.0.1:8765/sample.html",
        text: "This page verifies full-page translation, selection translation, and webpage summarization. A good translation keeps the author's intent.",
      },
      "zh",
    ),
  });
  console.log("summary:", summary.text.slice(0, 180));
  assert(summary.text.trim().length > 20, "summary should not be empty");

  console.log("API tests passed");
}

run().catch((error) => {
  console.error("API tests failed:", error.message);
  process.exit(1);
});
