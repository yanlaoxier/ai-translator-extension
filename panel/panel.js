const { LANGS, langLabel, getSettings, saveSettings, getHistory, clearHistory, getUsage, resetUsage } =
  globalThis.KeliStorage;

const titles = {
  access: "模型接入",
  language: "语言方向",
  history: "翻译记录",
  usage: "Token 账本",
};

const typeLabel = {
  selection: "划词",
  page: "整页",
  summary: "总结",
};

const els = {
  apiKey: document.getElementById("apiKey"),
  baseUrl: document.getElementById("baseUrl"),
  model: document.getElementById("model"),
  sourceLang: document.getElementById("sourceLang"),
  targetLang: document.getElementById("targetLang"),
  bilingual: document.getElementById("bilingual"),
  historyList: document.getElementById("history-list"),
  historyFilter: document.getElementById("history-filter"),
  status: document.getElementById("status-pill"),
  toast: document.getElementById("toast"),
  viewTitle: document.getElementById("view-title"),
};

fillLangSelects();
init().catch((error) => showToast(error.message, true));

function fillLangSelects() {
  const sourceOptions = LANGS.map((item) => `<option value="${item.id}">${item.label}</option>`).join("");
  const targetOptions = LANGS.filter((item) => item.id !== "auto")
    .map((item) => `<option value="${item.id}">${item.label}</option>`)
    .join("");
  els.sourceLang.innerHTML = sourceOptions;
  els.targetLang.innerHTML = targetOptions;
}

async function init() {
  await loadSettings();
  try {
    await renderHistory();
    await renderUsage();
  } catch (error) {
    showToast(error.message, true);
  }
  bind();
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.keliHistory) renderHistory();
    if (changes.keliUsage) renderUsage();
  });
}

function bind() {
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  document.getElementById("btn-save").addEventListener("click", onSaveAccess);
  document.getElementById("btn-test").addEventListener("click", onTest);
  document.getElementById("btn-lang-save").addEventListener("click", onSaveLang);
  document.getElementById("btn-swap").addEventListener("click", onSwap);
  document.getElementById("btn-clear-history").addEventListener("click", onClearHistory);
  document.getElementById("btn-reset-usage").addEventListener("click", onResetUsage);
  els.historyFilter.addEventListener("change", renderHistory);
}

function switchView(name) {
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.hidden = view.id !== `view-${name}`;
  });
  els.viewTitle.textContent = titles[name] || "管理台";
}

function setPill(text, state) {
  els.status.textContent = text;
  els.status.className = `pill${state ? ` ${state}` : ""}`;
}

function showToast(message, isError = false) {
  els.toast.hidden = false;
  els.toast.textContent = message;
  els.toast.classList.toggle("err", Boolean(isError));
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

async function loadSettings() {
  const settings = await getSettings();
  els.apiKey.value = settings.apiKey || "";
  els.baseUrl.value = settings.baseUrl || "";
  els.model.value = settings.model || "";
  els.sourceLang.value = settings.sourceLang || "auto";
  els.targetLang.value = settings.targetLang || "zh";
  els.bilingual.checked = settings.bilingual !== false;
  setPill(settings.apiKey ? "待测试" : "未连接");
}

async function onSaveAccess() {
  await saveSettings({
    apiKey: els.apiKey.value.trim(),
    baseUrl: els.baseUrl.value.trim(),
    model: els.model.value.trim(),
  });
  setPill("已保存", "ok");
  showToast("接入设置已保存");
}

async function onSaveLang() {
  await saveSettings({
    sourceLang: els.sourceLang.value,
    targetLang: els.targetLang.value,
    bilingual: els.bilingual.checked,
  });
  showToast("语言方向已保存");
}

function onSwap() {
  const source = els.sourceLang.value;
  const target = els.targetLang.value;
  if (source === "auto") {
    els.sourceLang.value = target;
    els.targetLang.value = target === "zh" ? "en" : "zh";
  } else {
    els.sourceLang.value = target;
    els.targetLang.value = source === "auto" ? "zh" : source;
  }
}

async function onTest() {
  setPill("测试中", "busy");
  try {
    await onSaveAccess();
    const result = await runtimeSend("TEST_CONNECTION", {
      apiKey: els.apiKey.value.trim(),
      baseUrl: els.baseUrl.value.trim(),
      model: els.model.value.trim(),
    });
    setPill("已连接", "ok");
    const tokens = result.usage?.total_tokens || 0;
    showToast(`连接成功 · ${result.model} · 本次 ${tokens} tokens`);
    await renderUsage();
  } catch (error) {
    setPill("失败", "err");
    showToast(error.message || "连接失败", true);
  }
}

function formatTime(stamp) {
  const date = new Date(stamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

async function renderHistory() {
  const filter = els.historyFilter.value;
  const history = await getHistory();
  const items = history.filter((item) => filter === "all" || item.type === filter);
  if (!items.length) {
    els.historyList.innerHTML = `<p class="empty">还没有记录。翻译网页或划词后会出现在这里。</p>`;
    return;
  }
  els.historyList.innerHTML = items
    .map((item) => {
      const tokens = item.usage?.total_tokens || 0;
      const route = `${langLabel(item.sourceLang)} → ${langLabel(item.targetLang)}`;
      return `<article class="item">
        <header>
          <span>${typeLabel[item.type] || item.type} · ${route}</span>
          <span>${formatTime(item.at)} · ${tokens} tok</span>
        </header>
        <p class="src">${escapeHtml(item.source || item.title || "")}</p>
        <p class="dst">${escapeHtml(item.result || "")}</p>
      </article>`;
    })
    .join("");
}

async function renderUsage() {
  const usage = await getUsage();
  document.getElementById("stat-total").textContent = formatNumber(usage.totalTokens);
  document.getElementById("stat-prompt").textContent = formatNumber(usage.promptTokens);
  document.getElementById("stat-completion").textContent = formatNumber(usage.completionTokens);
  document.getElementById("stat-requests").textContent = formatNumber(usage.requestCount);

  const days = lastDays(7);
  const max = Math.max(1, ...days.map((day) => usage.byDay?.[day]?.tokens || 0));
  document.getElementById("usage-chart").innerHTML = days
    .map((day) => {
      const tokens = usage.byDay?.[day]?.tokens || 0;
      const height = Math.max(6, Math.round((tokens / max) * 100));
      return `<div class="bar" title="${day} · ${tokens} tokens">
        <span style="height:${height}%"></span>
        <small>${day.slice(5)}</small>
      </div>`;
    })
    .join("");
}

function lastDays(count) {
  const days = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - i);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    days.push(`${year}-${month}-${day}`);
  }
  return days;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

async function onClearHistory() {
  if (!window.confirm("清空全部翻译记录？")) return;
  await clearHistory();
  await renderHistory();
  showToast("记录已清空");
}

async function onResetUsage() {
  if (!window.confirm("将 Token 统计清零？历史记录会保留。")) return;
  await resetUsage();
  await renderUsage();
  showToast("用量已清零");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
