import { chatCompletions, extractJsonArray, buildTranslateMessages, buildSummarizeMessages } from "../lib/api.js";
import { getSettings, saveSettings } from "../lib/storage.js";

const BATCH_CHAR_LIMIT = 3500;

chrome.runtime.onInstalled.addListener(() => {
  console.info("课利译已安装");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_SETTINGS":
      return getSettings();
    case "SAVE_SETTINGS":
      return saveSettings(message.payload || {});
    case "TEST_CONNECTION":
      return testConnection(message.payload);
    case "TRANSLATE_TEXTS":
      return translateTexts(message.payload || {});
    case "SUMMARIZE":
      return summarizePage(message.payload || {});
    default:
      throw new Error("未知请求");
  }
}

async function resolveConfig(override = {}) {
  const settings = await getSettings();
  return {
    apiKey: override.apiKey ?? settings.apiKey,
    baseUrl: override.baseUrl ?? settings.baseUrl,
    model: override.model ?? settings.model,
    targetLang: override.targetLang ?? settings.targetLang,
    bilingual: settings.bilingual,
  };
}

async function testConnection(override = {}) {
  const config = await resolveConfig(override);
  const { text } = await chatCompletions({
    ...config,
    temperature: 0,
    timeoutMs: 20_000,
    messages: [
      {
        role: "user",
        content: 'Reply with the exact word "OK" and nothing else.',
      },
    ],
  });
  return { reply: text.trim(), model: config.model };
}

function chunkBySize(texts, limit) {
  const batches = [];
  let current = [];
  let size = 0;

  texts.forEach((text, index) => {
    const piece = String(text || "");
    const cost = piece.length + 8;
    if (current.length && size + cost > limit) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push({ index, text: piece });
    size += cost;
  });

  if (current.length) {
    batches.push(current);
  }
  return batches;
}

async function translateTexts(payload) {
  const texts = Array.isArray(payload.texts) ? payload.texts.map((item) => String(item ?? "")) : [];
  if (!texts.length) {
    return [];
  }

  const config = await resolveConfig(payload);
  const output = new Array(texts.length).fill("");
  const batches = chunkBySize(texts, BATCH_CHAR_LIMIT);

  for (const batch of batches) {
    const { text } = await chatCompletions({
      ...config,
      temperature: 0.2,
      messages: buildTranslateMessages(
        batch.map((item) => item.text),
        config.targetLang,
      ),
    });

    let translated;
    try {
      translated = extractJsonArray(text);
    } catch {
      translated = batch.length === 1 ? [text.trim()] : batch.map(() => text.trim());
    }

    batch.forEach((item, offset) => {
      const value = translated[offset];
      output[item.index] = value == null || value === "" ? item.text : String(value);
    });
  }

  return output;
}

async function summarizePage(payload) {
  const config = await resolveConfig(payload);
  const text = String(payload.text || "").replace(/\s+\n/g, "\n").trim();
  if (!text) {
    throw new Error("当前页面没有可总结的正文");
  }

  const clipped = text.length > 12_000 ? `${text.slice(0, 12_000)}\n\n[正文已截断]` : text;
  const { text: summary } = await chatCompletions({
    ...config,
    temperature: 0.3,
    timeoutMs: 90_000,
    messages: buildSummarizeMessages(
      {
        title: payload.title || "",
        url: payload.url || "",
        text: clipped,
      },
      config.targetLang,
    ),
  });

  return summary.trim();
}
