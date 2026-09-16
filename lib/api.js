const DEFAULT_TIMEOUT_MS = 90_000;

export function completionsEndpoint(baseUrl) {
  return candidateEndpoints(baseUrl)[0];
}

export function candidateEndpoints(baseUrl) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) {
    throw new Error("请填写 Base URL");
  }
  if (/\/chat\/completions$/i.test(base)) {
    return [base];
  }
  if (/\/v1$/i.test(base)) {
    return [`${base}/chat/completions`];
  }
  if (/deepseek\.com$/i.test(base)) {
    return [`${base}/chat/completions`, `${base}/v1/chat/completions`];
  }
  return [`${base}/v1/chat/completions`, `${base}/chat/completions`];
}

export function langLabel(code) {
  return code === "en" ? "English" : "简体中文";
}

export function extractJsonArray(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw new Error("模型返回为空");
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : trimmed).trim();

  const tryParse = (value) => {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => (item == null ? "" : String(item)));
    }
    if (parsed && Array.isArray(parsed.translations)) {
      return parsed.translations.map((item) => (item == null ? "" : String(item)));
    }
    if (parsed && Array.isArray(parsed.items)) {
      return parsed.items.map((item) => (item == null ? "" : String(item)));
    }
    throw new Error("JSON 不是数组");
  };

  try {
    return tryParse(raw);
  } catch {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start !== -1 && end > start) {
      return tryParse(raw.slice(start, end + 1));
    }
    throw new Error("无法解析翻译结果");
  }
}

function errorMessage(data, status) {
  const message =
    data?.error?.message ||
    data?.message ||
    data?.error ||
    `请求失败（${status}）`;
  const text = typeof message === "string" ? message : JSON.stringify(message);
  if (status === 401 || /api key|invalid|unauth|authentication/i.test(text)) {
    return `API Key 无效：${text}`;
  }
  return text;
}

async function postChat(url, { apiKey, model, messages, temperature, signal }) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: model.trim(),
      messages,
      temperature,
      stream: false,
    }),
    signal,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(errorMessage(data, response.status));
    error.status = response.status;
    throw error;
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text || !String(text).trim()) {
    throw new Error("模型未返回内容");
  }

  return { text: String(text), raw: data, url };
}

export async function chatCompletions({
  apiKey,
  baseUrl,
  model,
  messages,
  temperature = 0.2,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!String(apiKey || "").trim()) {
    throw new Error("请先填写 API Key");
  }
  if (!String(model || "").trim()) {
    throw new Error("请先填写模型名称");
  }

  const urls = candidateEndpoints(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let lastError;

  try {
    for (const url of urls) {
      try {
        return await postChat(url, {
          apiKey,
          model,
          messages,
          temperature,
          signal: controller.signal,
        });
      } catch (error) {
        lastError = error;
        if (error?.status === 401 || error?.status === 402 || error?.status === 403) {
          throw error;
        }
        if (error?.status && error.status !== 404) {
          throw error;
        }
      }
    }
    throw lastError || new Error("请求失败");
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("请求超时，请稍后重试");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function buildTranslateMessages(texts, targetLang) {
  const target = langLabel(targetLang);
  const payload = texts.map((text, index) => `${index}. ${text}`).join("\n");

  return [
    {
      role: "system",
      content:
        "You are a precise bilingual translator. Translate faithfully, keep names/URLs/code unchanged, and return JSON only.",
    },
    {
      role: "user",
      content: `Translate every item into ${target}.
Return a JSON array of strings, same length and order as the input. No markdown, no keys, no commentary.

Items:
${payload}`,
    },
  ];
}

export function buildSummarizeMessages(page, targetLang) {
  const target = langLabel(targetLang);
  return [
    {
      role: "system",
      content:
        "You are a concise reading assistant. Summarize web pages clearly for busy readers.",
    },
    {
      role: "user",
      content: `请用${target}总结下面的网页。结构必须是：
1) 一句话概述
2) 4 到 6 条要点（短句）
3) 一句给读者的结论

标题：${page.title || "（无标题）"}
网址：${page.url || ""}
正文：
${page.text}`,
    },
  ];
}
