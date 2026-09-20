const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "INPUT",
  "SELECT",
  "CODE",
  "PRE",
  "SVG",
  "MATH",
  "KBD",
  "SAMP",
]);

const HOST_ID = "keli-host";
let uiCssPromise = null;
let busy = false;

const PAGE_TYPES = new Set([
  "KELI_TRANSLATE_PAGE",
  "KELI_RESTORE_PAGE",
  "KELI_SUMMARIZE_PAGE",
  "KELI_TRANSLATE_SELECTION",
]);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!PAGE_TYPES.has(message?.type)) {
    return false;
  }
  handlePageMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

document.addEventListener("mouseup", onMouseUp);
document.addEventListener("keydown", onKeyDown, true);
document.addEventListener("mousedown", (event) => {
  if (event.target?.closest?.("#keli-host")) return;
  hideChip();
});

async function handlePageMessage(message) {
  if (message?.type === "KELI_TRANSLATE_PAGE") {
    await translatePage();
    return true;
  }
  if (message?.type === "KELI_RESTORE_PAGE") {
    restorePage();
    return true;
  }
  if (message?.type === "KELI_SUMMARIZE_PAGE") {
    await summarizePage();
    return true;
  }
  if (message?.type === "KELI_TRANSLATE_SELECTION") {
    await translateSelection(true);
    return true;
  }
  return false;
}

function onKeyDown(event) {
  if (event.altKey && !event.shiftKey && !event.ctrlKey && event.key.toLowerCase() === "t") {
    event.preventDefault();
    translateSelection(true);
  }
}

function onMouseUp(event) {
  if (event.target?.closest?.("#keli-host")) return;
  window.setTimeout(() => {
    const text = selectedText();
    if (text.length >= 2) {
      showChip(event.clientX, event.clientY, text);
    } else {
      hideChip();
    }
  }, 10);
}

function selectedText() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return "";
  return selection.toString().replace(/\s+/g, " ").trim();
}

async function send(type, payload) {
  const response = await chrome.runtime.sendMessage({ type, payload });
  if (!response?.ok) {
    throw new Error(response?.error || "插件后台无响应");
  }
  return response.result;
}

async function translateSelection(fromHotkey = false) {
  const text = selectedText();
  if (!text) {
    if (fromHotkey) toast("请先划选要翻译的文字");
    return;
  }

  const settings = await send("GET_SETTINGS");
  const rect = selectionRect() || { left: 24, top: 24, bottom: 48, right: 160 };
  showCard(rect, { loading: true, source: text });

  try {
    const [translated] = await send("TRANSLATE_TEXTS", {
      texts: [text],
      sourceLang: settings.sourceLang,
      targetLang: settings.targetLang,
      kind: "selection",
      title: document.title,
      url: location.href,
    });
    showCard(rect, { source: text, translated: translated || "" });
  } catch (error) {
    showCard(rect, { source: text, error: error.message });
  }
}

function selectionRect() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  return rect;
}

function collectTextNodes() {
  const nodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest("#keli-host, .keli-pair, .keli-t, [contenteditable='true']")) {
        return NodeFilter.FILTER_REJECT;
      }
      const style = window.getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        return NodeFilter.FILTER_REJECT;
      }
      const text = node.nodeValue.replace(/\s+/g, " ").trim();
      if (text.length < 2) return NodeFilter.FILTER_REJECT;
      if (/^[\d\s.,:;!?'"“”‘’\-_/\\()[\]]+$/.test(text)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let current = walker.nextNode();
  while (current) {
    nodes.push(current);
    current = walker.nextNode();
  }
  return nodes;
}

function isBlockish(element) {
  if (!element) return false;
  const display = window.getComputedStyle(element).display;
  return /block|flex|grid|table|list-item/.test(display);
}

function applyTranslation(node, translated, bilingual) {
  const original = node.nodeValue;
  const parent = node.parentElement;
  if (!parent) return;

  const usePair = bilingual && isBlockish(parent) && original.trim().length > 24;
  if (usePair) {
    const wrap = document.createElement("span");
    wrap.className = "keli-pair";
    wrap.dataset.keliOriginal = original;

    const src = document.createElement("span");
    src.className = "keli-src";
    src.textContent = original;

    const dst = document.createElement("span");
    dst.className = "keli-dst";
    dst.textContent = translated;

    wrap.append(src, dst);
    parent.replaceChild(wrap, node);
    return;
  }

  const span = document.createElement("span");
  span.className = "keli-t";
  span.dataset.keliOriginal = original;
  span.title = original.trim();
  span.textContent = translated;
  parent.replaceChild(span, node);
}

function restorePage() {
  document.querySelectorAll(".keli-pair, .keli-t").forEach((el) => {
    const original = el.dataset.keliOriginal ?? "";
    el.replaceWith(document.createTextNode(original));
  });
    toast("已还原原文");
}

function alreadyInTarget(text, targetLang) {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const kana = (text.match(/[\u3040-\u30ff]/g) || []).length;
  const hangul = (text.match(/[\uac00-\ud7af]/g) || []).length;
  const cyr = (text.match(/[\u0400-\u04ff]/g) || []).length;
  if (targetLang === "zh") return cjk >= 4 && cjk >= latin && kana < 2 && hangul < 2;
  if (targetLang === "ja") return kana >= 2 || (cjk >= 4 && kana >= 1);
  if (targetLang === "ko") return hangul >= 4;
  if (targetLang === "ru") return cyr >= 6;
  if (["en", "fr", "de", "es"].includes(targetLang)) {
    return latin >= 8 && latin > cjk * 2 && hangul === 0;
  }
  return false;
}

async function translatePage() {
  if (busy) return;
  busy = true;
  const settings = await send("GET_SETTINGS");
  const nodes = collectTextNodes().filter((node) => {
    const text = node.nodeValue.replace(/\s+/g, " ").trim();
    return !alreadyInTarget(text, settings.targetLang);
  });
  if (!nodes.length) {
    busy = false;
    await toast("没有找到需要翻译的文本");
    return;
  }

  await showProgress(0, nodes.length);
  try {
    const batchSize = 16;
    let done = 0;

    for (let i = 0; i < nodes.length; i += batchSize) {
      const sliceNodes = nodes.slice(i, i + batchSize).filter((node) => node.isConnected);
      const sliceTexts = sliceNodes.map((node) => node.nodeValue.replace(/\s+/g, " ").trim());
      if (!sliceTexts.length) continue;
      const translated = await send("TRANSLATE_TEXTS", {
        texts: sliceTexts,
        sourceLang: settings.sourceLang,
        targetLang: settings.targetLang,
        kind: "page",
        title: document.title,
        url: location.href,
      });
      sliceNodes.forEach((node, index) => {
        if (!node.isConnected) return;
        applyTranslation(node, translated[index] || sliceTexts[index], settings.bilingual !== false);
      });
      done += sliceNodes.length;
      await showProgress(done, nodes.length);
    }
    await toast("本页翻译完成");
  } catch (error) {
    await toast(error.message || "翻译失败", true);
  } finally {
    await hideProgress();
    busy = false;
  }
}

function pageText() {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll("script, style, noscript, iframe, svg, #keli-host, nav, footer").forEach((el) => el.remove());
  return (clone.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
}

async function summarizePage() {
  if (busy) return;
  busy = true;
  await showPanel({ loading: true });
  try {
    const settings = await send("GET_SETTINGS");
    const summary = await send("SUMMARIZE", {
      title: document.title,
      url: location.href,
      text: pageText(),
      targetLang: settings.targetLang,
    });
    await showPanel({ title: document.title, summary });
  } catch (error) {
    await showPanel({ error: error.message || "总结失败" });
  } finally {
    busy = false;
  }
}

async function getShadow() {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    Object.assign(host.style, {
      all: "initial",
      position: "fixed",
      zIndex: "2147483646",
      inset: "0",
      pointerEvents: "none",
    });
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = await loadUiCss();
    shadow.appendChild(style);

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = "译";
    chip.hidden = true;
    chip.addEventListener("mousedown", (event) => event.preventDefault());
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      translateSelection();
    });

    const card = document.createElement("section");
    card.className = "card";
    card.hidden = true;

    const panel = document.createElement("aside");
    panel.className = "panel";
    panel.hidden = true;

    const toastEl = document.createElement("div");
    toastEl.className = "toast";
    toastEl.hidden = true;

    const progress = document.createElement("div");
    progress.className = "progress";
    progress.hidden = true;
    progress.innerHTML = `<span></span><label>正在翻译…</label>`;

    shadow.append(chip, card, panel, toastEl, progress);
  }
  return host.shadowRoot;
}

async function loadUiCss() {
  if (!uiCssPromise) {
    uiCssPromise = fetch(chrome.runtime.getURL("content/ui.css")).then((res) => res.text());
  }
  return uiCssPromise;
}

function hideChip() {
  const host = document.getElementById(HOST_ID);
  const chip = host?.shadowRoot?.querySelector(".chip");
  if (chip) chip.hidden = true;
}

async function showChip(x, y, text) {
  const shadow = await getShadow();
  const chip = shadow.querySelector(".chip");
  chip.hidden = false;
  chip.style.pointerEvents = "auto";
  chip.dataset.text = text;
  const left = Math.min(window.innerWidth - 52, Math.max(8, x + 8));
  const top = Math.min(window.innerHeight - 40, Math.max(8, y + 12));
  chip.style.left = `${left}px`;
  chip.style.top = `${top}px`;
}

async function showCard(rect, state) {
  const shadow = await getShadow();
  hideChip();
  const card = shadow.querySelector(".card");
  card.hidden = false;
  card.style.pointerEvents = "auto";
  const top = Math.min(window.innerHeight - 180, Math.max(12, rect.bottom + 10));
  const left = Math.min(window.innerWidth - 340, Math.max(12, rect.left));
  card.style.top = `${top}px`;
  card.style.left = `${left}px`;

  if (state.loading) {
    card.innerHTML = `<div class="card-head">课利译</div><p class="muted">正在翻译…</p>`;
    return;
  }
  if (state.error) {
    card.innerHTML = `<div class="card-head">翻译失败</div><p class="error">${escapeHtml(state.error)}</p><button type="button" class="close">关闭</button>`;
    card.querySelector(".close").onclick = () => {
      card.hidden = true;
    };
    return;
  }

  card.innerHTML = `
    <div class="card-head">
      <span>划词翻译</span>
      <button type="button" class="close" aria-label="关闭">×</button>
    </div>
    <p class="src">${escapeHtml(state.source)}</p>
    <p class="dst">${escapeHtml(state.translated)}</p>
    <div class="card-actions">
      <button type="button" class="copy">复制译文</button>
    </div>
  `;
  card.querySelector(".close").onclick = () => {
    card.hidden = true;
  };
  card.querySelector(".copy").onclick = async () => {
    await navigator.clipboard.writeText(state.translated || "");
    toast("已复制译文");
  };
}

async function showPanel(state) {
  const shadow = await getShadow();
  const panel = shadow.querySelector(".panel");
  panel.hidden = false;
  panel.style.pointerEvents = "auto";

  if (state.loading) {
    panel.innerHTML = `<div class="panel-head"><strong>网页总结</strong></div><p class="muted">正在阅读本页…</p>`;
    return;
  }
  if (state.error) {
    panel.innerHTML = `<div class="panel-head"><strong>总结失败</strong><button class="close">×</button></div><p class="error">${escapeHtml(state.error)}</p>`;
    panel.querySelector(".close").onclick = () => {
      panel.hidden = true;
    };
    return;
  }

  panel.innerHTML = `
    <div class="panel-head">
      <div>
        <strong>网页总结</strong>
        <em>${escapeHtml(state.title || "")}</em>
      </div>
      <button type="button" class="close" aria-label="关闭">×</button>
    </div>
    <div class="summary">${escapeHtml(state.summary).replace(/\n/g, "<br />")}</div>
    <button type="button" class="copy">复制总结</button>
  `;
  panel.querySelector(".close").onclick = () => {
    panel.hidden = true;
  };
  panel.querySelector(".copy").onclick = async () => {
    await navigator.clipboard.writeText(state.summary || "");
    toast("已复制总结");
  };
}

async function showProgress(done, total) {
  const shadow = await getShadow();
  const progress = shadow.querySelector(".progress");
  progress.hidden = false;
  const ratio = total ? Math.round((done / total) * 100) : 0;
  progress.querySelector("span").style.width = `${ratio}%`;
  progress.querySelector("label").textContent = `正在翻译 ${done}/${total}`;
}

async function hideProgress() {
  const host = document.getElementById(HOST_ID);
  const progress = host?.shadowRoot?.querySelector(".progress");
  if (progress) progress.hidden = true;
}

let toastTimer = 0;
async function toast(message, isError = false) {
  const shadow = await getShadow();
  const el = shadow.querySelector(".toast");
  el.hidden = false;
  el.classList.toggle("err", isError);
  el.textContent = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.hidden = true;
  }, 2800);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
