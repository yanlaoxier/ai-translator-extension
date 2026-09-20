const { getSettings, saveSettings } = globalThis.KeliStorage;

const els = {
  apiKey: document.getElementById("apiKey"),
  baseUrl: document.getElementById("baseUrl"),
  model: document.getElementById("model"),
  bilingual: document.getElementById("bilingual"),
  pill: document.getElementById("conn-pill"),
  toast: document.getElementById("toast"),
  save: document.getElementById("btn-save"),
  test: document.getElementById("btn-test"),
  translate: document.getElementById("btn-translate"),
  restore: document.getElementById("btn-restore"),
  summary: document.getElementById("btn-summary"),
};

let targetLang = "zh";

init().catch((error) => showToast(error.message, true));

async function init() {
  const settings = await getSettings();
  els.apiKey.value = settings.apiKey || "";
  els.baseUrl.value = settings.baseUrl || "";
  els.model.value = settings.model || "";
  els.bilingual.checked = settings.bilingual !== false;
  targetLang = settings.targetLang === "en" ? "en" : "zh";
  syncLangButtons();
  setPill(settings.apiKey ? "待测试" : "未连接");

  document.querySelectorAll(".lang-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      targetLang = button.dataset.lang;
      syncLangButtons();
      await saveSettings({ targetLang });
    });
  });

  els.bilingual.addEventListener("change", async () => {
    await saveSettings({ bilingual: els.bilingual.checked });
  });

  els.save.addEventListener("click", onSave);
  els.test.addEventListener("click", onTest);
  els.translate.addEventListener("click", () => sendToTab("KELI_TRANSLATE_PAGE"));
  els.restore.addEventListener("click", () => sendToTab("KELI_RESTORE_PAGE"));
  els.summary.addEventListener("click", () => sendToTab("KELI_SUMMARIZE_PAGE"));
  document.getElementById("btn-panel").addEventListener("click", async () => {
    await chrome.runtime.openOptionsPage();
  });
}

function syncLangButtons() {
  document.querySelectorAll(".lang-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.lang === targetLang);
  });
}

function setPill(text, state) {
  els.pill.textContent = text;
  els.pill.className = `pill${state ? ` ${state}` : ""}`;
}

function showToast(message, isError = false) {
  els.toast.hidden = false;
  els.toast.textContent = message;
  els.toast.classList.toggle("err", Boolean(isError));
}

function currentForm() {
  return {
    apiKey: els.apiKey.value.trim(),
    baseUrl: els.baseUrl.value.trim(),
    model: els.model.value.trim(),
    targetLang,
    bilingual: els.bilingual.checked,
  };
}

async function onSave() {
  await saveSettings(currentForm());
  showToast("设置已保存");
  setPill("已保存", "ok");
}

async function runtimeSend(type, payload) {
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type, payload });
  } catch (error) {
    throw new Error("后台未运行。请打开 chrome://extensions，找到「课利译」后点「重新加载」。");
  }
  if (!response?.ok) {
    throw new Error(response?.error || "后台无响应");
  }
  return response.result;
}

async function onTest() {
  els.test.disabled = true;
  setPill("测试中", "busy");
  try {
    await saveSettings(currentForm());
    const result = await runtimeSend("TEST_CONNECTION", currentForm());
    setPill("已连接", "ok");
    showToast(`连接成功 · ${result.model}`);
  } catch (error) {
    setPill("失败", "err");
    showToast(error.message || "连接失败", true);
  } finally {
    els.test.disabled = false;
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("没有可用的标签页");
  }
  if (!tab.url || /^(chrome|edge|about|chrome-extension):/i.test(tab.url)) {
    throw new Error("当前页面无法注入脚本，请打开普通网页后再试");
  }
  return tab;
}

async function sendToTab(type) {
  const actionMap = {
    KELI_TRANSLATE_PAGE: els.translate,
    KELI_RESTORE_PAGE: els.restore,
    KELI_SUMMARIZE_PAGE: els.summary,
  };
  const button = actionMap[type];
  if (button) button.disabled = true;
  setPill("处理中", "busy");

  try {
    await saveSettings(currentForm());
    const tab = await getActiveTab();
    try {
      await chrome.tabs.sendMessage(tab.id, { type });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["content/content.css"],
      });
      await chrome.tabs.sendMessage(tab.id, { type });
    }
    showToast(type === "KELI_RESTORE_PAGE" ? "已还原本页" : "已发送到当前页面");
    setPill("进行中", "busy");
  } catch (error) {
    setPill("失败", "err");
    showToast(error.message || "无法操作当前页面", true);
  } finally {
    if (button) button.disabled = false;
  }
}
