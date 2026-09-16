const DEFAULTS = {
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  targetLang: "zh",
  bilingual: true,
};

export function defaultSettings() {
  return { ...DEFAULTS };
}

export async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(partial) {
  const next = {};
  for (const [key, value] of Object.entries(partial || {})) {
    if (key in DEFAULTS) {
      next[key] = value;
    }
  }
  await chrome.storage.local.set(next);
  return getSettings();
}
