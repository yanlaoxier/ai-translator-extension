import http from "node:http";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(payload));
}

function completion(content) {
  return {
    id: "chatcmpl-keli-mock",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "deepseek-v4-flash",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };
}

function extractItems(prompt) {
  const match = prompt.match(/Items:\s*([\s\S]+)$/);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
}

function translateOne(text, toChinese) {
  const mapZh = [
    [/Hello, world\. This is a translation plugin\./i, "你好，世界。这是一个翻译插件。"],
    [/This page is designed to verify full-page translation, selection translation, and webpage summarization\./i, "本页面用于验证全页翻译、划词翻译和网页总结。"],
    [/Why bilingual reading matters/i, "为什么双语阅读很重要"],
    [/A good translation keeps the author's intent[\s\S]*/i, "好的翻译会保住作者原意，而不是逐词对照词典。人名、产品词和原文链接应保持原样，同时让周围的句子变得好读。"],
    [/Preserve proper nouns such as DeepSeek and OpenAI\./i, "保留 DeepSeek 和 OpenAI 这类专有名词。"],
    [/Keep the original layout, including lists and headings\./i, "保持原有排版，包括列表和标题。"],
    [/Visit/i, "访问"],
    [/example.com/i, "example.com"],
    [/Mixed paragraph/i, "中英混合段落"],
    [/Chrome 扩展可以使用 OpenAI 协议调用 DeepSeek\. Fill in your API Key and Base URL in the popup, then translate this sentence\./i, "Chrome 扩展可以使用 OpenAI 协议调用 DeepSeek。在弹窗中填写 API Key 和 Base URL，然后翻译这句话。"],
    [/课利译功能测试页/, "Keli Translate test page"],
    [/课利译测试文章/, "Keli Translate sample article"],
    [/中文段落/, "Chinese section"],
    [/划词翻译应当在选中文字后出现一枚小按钮[\s\S]*/ , "Selection translation should show a small button after highlighting text. A page summary should capture the thesis, list key points, and give the reader one actionable takeaway."],
  ];

  if (toChinese) {
    for (const [pattern, value] of mapZh) {
      if (pattern.test(text)) return value;
    }
    if (/[\u4e00-\u9fff]/.test(text) && !/[A-Za-z]{4,}/.test(text)) return text;
    return `译文：${text}`;
  }

  if (/[\u4e00-\u9fff]/.test(text)) {
    return "Selection translation should show a translation after the user highlights text.";
  }
  return text;
}

function replyFor(body) {
  const prompt = (body.messages || []).map((item) => item.content).join("\n");
  if (/exact word "OK"/i.test(prompt)) {
    return "OK";
  }
  if (/JSON array of strings/i.test(prompt) || /Translate every item/i.test(prompt)) {
    const toChinese = /简体中文/.test(prompt);
    const items = extractItems(prompt);
    return JSON.stringify(items.map((item) => translateOne(item, toChinese)));
  }
  if (/总结下面的网页|Summarize/.test(prompt)) {
    if (/English/.test(prompt) && !/简体中文/.test(prompt)) {
      return "One-line overview: this page verifies a Chrome translation extension.\n- Full-page translation\n- Selection translation\n- Webpage summary\n- OpenAI-compatible settings\nConclusion: fill in the API settings and try each action.";
    }
    return "一句话概述：这是课利译的功能测试页，用来验证翻译与总结。\n- 支持全页面翻译\n- 支持划词翻译\n- 支持网页总结\n- 兼容 OpenAI 协议配置\n结论：在弹窗填好接口后即可完成本页验证。";
  }
  return "OK";
}

export function startMockOpenAI(port = 8787) {
  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      json(res, 204, {});
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/models")) {
      json(res, 200, { data: [{ id: "deepseek-v4-flash" }] });
      return;
    }
    if (req.method === "POST" && /chat\/completions/.test(req.url || "")) {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        json(res, 200, completion(replyFor(body)));
      } catch (error) {
        json(res, 400, { error: { message: error.message } });
      }
      return;
    }
    json(res, 404, { error: { message: "not found" } });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

if (import.meta.url === `file://${process.argv[1].replaceAll("\\", "/")}` || process.argv[1]?.endsWith("mock-openai.mjs")) {
  const port = Number(process.env.PORT || 8787);
  startMockOpenAI(port).then(() => {
    console.log(`mock openai listening on 127.0.0.1:${port}`);
  });
}
