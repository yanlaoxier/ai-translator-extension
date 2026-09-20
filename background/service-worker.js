importScripts("../lib/api.js", "../lib/storage.js");

const { chatCompletions, extractJsonArray, buildTranslateMessages, buildSummarizeMessages } = self.KeliApi;
const {
  getSettings,
  saveSettings,
  getHistory,
  appendHistory,
  clearHistory,
  getUsage,
  addUsage,
  resetUsage,
  extractUsage,
  clipText,
} = self.KeliStorage;

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

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "GET_SETTINGS":
      return getSettings();
    case "SAVE_SETTINGS":
      return saveSettings(message.payload || {});
    case "TEST_CONNECTION":
      return testConnection(message.payload);
    case "TRANSLATE_TEXTS":
      return translateTexts(message.payload || {}, sender);
    case "SUMMARIZE":
      return summarizePage(message.payload || {}, sender);
    case "GET_HISTORY":
      return getHistory();
    case "CLEAR_HISTORY":
      return clearHistory();
    case "GET_USAGE":
      return getUsage();
    case "RESET_USAGE":
      return resetUsage();
    case "OPEN_PANEL":
      await chrome.runtime.openOptionsPage();
      return true;
    default:
      return null;
  }
}

async function resolveConfig(override = {}) {
  const settings = await getSettings();
  return {
    apiKey: override.apiKey ?? settings.apiKey,
    baseUrl: override.baseUrl ?? settings.baseUrl,
    model: override.model ?? settings.model,
    sourceLang: override.sourceLang ?? settings.sourceLang ?? "auto",
    targetLang: override.targetLang ?? settings.targetLang,
    bilingual: settings.bilingual,
  };
}

function mergeUsage(parts) {
  return parts.reduce(
    (sum, item) => ({
      prompt_tokens: sum.prompt_tokens + (item?.prompt_tokens || 0),
      completion_tokens: sum.completion_tokens + (item?.completion_tokens || 0),
      total_tokens: sum.total_tokens + (item?.total_tokens || 0),
    }),
    { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  );
}

async function record(entry, usage) {
  if (usage?.total_tokens || usage?.prompt_tokens) {
    await addUsage(usage);
  }
  await appendHistory({
    ...entry,
    usage: usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

async function testConnection(override = {}) {
  const config = await resolveConfig(override);
  const result = await chatCompletions({
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
  const usage = result.usage || extractUsage(result.raw);
  await addUsage(usage);
  return { reply: result.text.trim(), model: config.model, usage };
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

async function translateTexts(payload, sender) {
  const texts = Array.isArray(payload.texts) ? payload.texts.map((item) => String(item ?? "")) : [];
  if (!texts.length) {
    return [];
  }

  const config = await resolveConfig(payload);
  const output = new Array(texts.length).fill("");
  const batches = chunkBySize(texts, BATCH_CHAR_LIMIT);
  const usages = [];

  for (const batch of batches) {
    const result = await chatCompletions({
      ...config,
      temperature: 0.2,
      messages: buildTranslateMessages(
        batch.map((item) => item.text),
        config.targetLang,
        config.sourceLang,
      ),
    });
    usages.push(result.usage || extractUsage(result.raw));

    let translated;
    try {
      translated = extractJsonArray(result.text);
    } catch {
      translated = batch.length === 1 ? [result.text.trim()] : batch.map(() => result.text.trim());
    }

    batch.forEach((item, offset) => {
      const value = translated[offset];
      output[item.index] = value == null || value === "" ? item.text : String(value);
    });
  }

  const usage = mergeUsage(usages);
  const kind = payload.kind || (texts.length === 1 ? "selection" : "page");
  await record(
    {
      type: kind,
      sourceLang: config.sourceLang,
      targetLang: config.targetLang,
      source: clipText(texts.join("\n"), 360),
      result: clipText(output.join("\n"), 360),
      title: payload.title || sender?.tab?.title || "",
      url: payload.url || sender?.tab?.url || "",
      count: texts.length,
    },
    usage,
  );

  return output;
}

async function summarizePage(payload, sender) {
  const config = await resolveConfig(payload);
  const text = String(payload.text || "").replace(/\s+\n/g, "\n").trim();
  if (!text) {
    throw new Error("当前页面没有可总结的正文");
  }

  const clipped = text.length > 12_000 ? `${text.slice(0, 12_000)}\n\n[正文已截断]` : text;
  const result = await chatCompletions({
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

  const summary = result.text.trim();
  const usage = result.usage || extractUsage(result.raw);
  await record(
    {
      type: "summary",
      sourceLang: config.sourceLang,
      targetLang: config.targetLang,
      source: clipText(clipped, 360),
      result: clipText(summary, 360),
      title: payload.title || sender?.tab?.title || "",
      url: payload.url || sender?.tab?.url || payload.url || "",
    },
    usage,
  );

  return summary;
}
