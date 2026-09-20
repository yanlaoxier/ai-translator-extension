(function (root) {
const LANGS = [
  { id: "auto", label: "自动检测" },
  { id: "zh", label: "中文" },
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
  { id: "ko", label: "한국어" },
  { id: "fr", label: "Français" },
  { id: "de", label: "Deutsch" },
  { id: "es", label: "Español" },
  { id: "ru", label: "Русский" },
];

const DEFAULTS = {
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  sourceLang: "auto",
  targetLang: "zh",
  bilingual: true,
};

const HISTORY_KEY = "keliHistory";
const USAGE_KEY = "keliUsage";
const MAX_HISTORY = 200;
const MAX_DAY_KEYS = 60;

function defaultSettings() {
  return { ...DEFAULTS };
}

function langLabel(code) {
  return LANGS.find((item) => item.id === code)?.label || "简体中文";
}

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

async function saveSettings(partial) {
  const next = {};
  for (const [key, value] of Object.entries(partial || {})) {
    if (key in DEFAULTS) {
      next[key] = value;
    }
  }
  await chrome.storage.local.set(next);
  return getSettings();
}

function emptyUsage() {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    requestCount: 0,
    byDay: {},
  };
}

function extractUsage(raw) {
  const usage = raw?.usage || {};
  const prompt = Number(usage.prompt_tokens) || 0;
  const completion = Number(usage.completion_tokens) || 0;
  const total = Number(usage.total_tokens) || prompt + completion;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  };
}

async function getHistory() {
  const stored = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  return Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
}

async function appendHistory(entry) {
  const history = await getHistory();
  history.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    at: Date.now(),
    ...entry,
  });
  await chrome.storage.local.set({ [HISTORY_KEY]: history.slice(0, MAX_HISTORY) });
  return getHistory();
}

async function clearHistory() {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
  return [];
}

async function getUsage() {
  const stored = await chrome.storage.local.get({ [USAGE_KEY]: emptyUsage() });
  return { ...emptyUsage(), ...(stored[USAGE_KEY] || {}) };
}

async function addUsage(usage) {
  const current = await getUsage();
  const prompt = Number(usage?.prompt_tokens) || 0;
  const completion = Number(usage?.completion_tokens) || 0;
  const total = Number(usage?.total_tokens) || prompt + completion;
  const day = localDay();

  current.promptTokens += prompt;
  current.completionTokens += completion;
  current.totalTokens += total;
  current.requestCount += 1;
  current.byDay = current.byDay || {};
  current.byDay[day] = current.byDay[day] || { tokens: 0, requests: 0 };
  current.byDay[day].tokens += total;
  current.byDay[day].requests += 1;

  const days = Object.keys(current.byDay).sort();
  if (days.length > MAX_DAY_KEYS) {
    days.slice(0, days.length - MAX_DAY_KEYS).forEach((key) => {
      delete current.byDay[key];
    });
  }

  await chrome.storage.local.set({ [USAGE_KEY]: current });
  return current;
}

async function resetUsage() {
  const empty = emptyUsage();
  await chrome.storage.local.set({ [USAGE_KEY]: empty });
  return empty;
}

function localDay(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clipText(value, limit = 280) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}
root.KeliStorage = { LANGS, defaultSettings, langLabel, getSettings, saveSettings, emptyUsage, extractUsage, getHistory, appendHistory, clearHistory, getUsage, addUsage, resetUsage, localDay, clipText };
})(typeof globalThis !== "undefined" ? globalThis : self);
