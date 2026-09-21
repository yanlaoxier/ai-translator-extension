# 课利译

Chrome 浏览器 AI 翻译插件：全页面翻译、划词翻译、网页总结。兼容 OpenAI 协议，在弹窗中自行填写 API Key 与 Base URL。

## 官方网站

👉 <https://github.com/yanlaoxier/ai-translator-website> — 译笺 (Marginalia) 官方宣传站
📝 [Releases & Changelog](https://github.com/yanlaoxier/ai-translator-extension/releases)

## 安装

1. 打开 Chrome，进入 `chrome://extensions`
2. 打开右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本目录

## 使用

- 弹窗可快速翻译本页、总结，或打开 **管理面板**
- 管理面板：配置 API Key / Base URL、切换原语言与目标语言、查看翻译历史、统计 Token 消耗
- **翻译本页**：把当前网页译成目标语言，可对照显示原文
- **划词翻译**：选中文字后点击「译」，或使用 `Alt+T`
- **网页总结**：生成本页概要、要点与结论

## 安全与隐私

- API Key **只保存在你本机的 `chrome.storage.local`**，源码中永远为空，仓库里不含任何密钥
- 请求由浏览器**直连你填写的 Base URL**，本项目没有中转服务器，不收集任何数据
- 详见 [SECURITY.md](./SECURITY.md)（含数据流向图与泄露处置流程）
- 发现漏洞请按 SECURITY.md 私下反馈，不要开公开 Issue
