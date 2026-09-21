# 安全政策 · Security Policy

本文件说明「课利译」Chrome 扩展如何处理你的 API Key，以及发现安全问题时应如何反馈。

---

## 一、支持的版本

| 版本 | 是否接收安全修复 |
| --- | --- |
| `1.1.x` | ✅ 支持 |
| `< 1.1` | ❌ 不再维护 |

---

## 二、报告安全问题

如果你发现了安全漏洞，请**不要直接开公开 Issue**，改用以下方式私下反馈：

- 邮箱：`hi@verso.app`（标题请以 `[SECURITY]` 开头）
- 或使用 GitHub 的 [Private vulnerability reporting](https://github.com/yanlaoxier/ai-translator-extension/security/advisories/new)

请尽量附上：受影响版本、复现步骤、影响范围。我会在 **7 天内**回复，并在修复后于 Release 说明中致谢（如你愿意署名）。

---

## 三、API Key 的存储与使用（核心）

### 3.1 一句话结论

**你的 API Key 永远不会出现在本仓库的源码里。** 源码中该字段的默认值是一个空字符串，Key 只存在于**你自己浏览器的本地存储**中，由你本人在插件面板里填写。

### 3.2 存储位置

| 项目 | 说明 |
| --- | --- |
| 存储介质 | `chrome.storage.local` |
| 存储键名 | `apiKey` |
| 默认值 | `""`（空）—— 定义在 `lib/storage.js` 的 `DEFAULTS` |
| 物理位置 | 浏览器用户数据目录下的扩展本地存储（Windows 大致为 `%LOCALAPPDATA%\Google\Chrome\User Data\<Profile>\Local Extension Settings\<扩展ID>\`） |
| 是否加密 | **否**。Chrome 以明文形式保存在本地 LevelDB 中 |

### 3.3 写入路径（你填写 Key 时发生了什么）

```
你打开管理面板 panel/panel.html   ← manifest.json 的 options_ui 指向此处
        │
        │ 在「模型接入」里填入 API Key / Base URL / 模型名
        ▼
panel/panel.js  →  KeliStorage.saveSettings()
        │
        ▼
chrome.storage.local.set({ apiKey, baseUrl, model })   ← 仅写入你本机浏览器
```

### 3.4 读取与发送路径（你翻译时发生了什么）

```
background/service-worker.js  resolveConfig()
        │  从 chrome.storage.local 读出 apiKey
        ▼
lib/api.js  postChat()
        │  fetch(baseUrl + "/chat/completions", {
        │    headers: { Authorization: `Bearer ${apiKey}` }   ← 此处才用到 Key
        │  })
        ▼
你**自己填写**的 Base URL（默认 https://api.deepseek.com）
```

### 3.5 数据流向（重要）

```
   你的浏览器                              模型服务商
┌──────────────┐                      ┌──────────────────┐
│ 面板 / 后台  │ ──── HTTPS 直连 ────▶ │ api.deepseek.com │
│  持有 Key    │   携带 Bearer Key     │  或你指定的服务   │
└──────────────┘                      └──────────────────┘
        ✗ 没有中间服务器
        ✗ 本项目不收集、不上传、不转储任何 Key
```

本扩展**没有自建后端**。请求由浏览器直接发往你在面板中配置的服务地址，密钥只出现在这一条你与模型服务商之间的链路上。

### 3.6 哪些组件接触不到 Key

| 组件 | 是否接触 Key | 原因 |
| --- | --- | --- |
| `content/content.js`（注入网页的脚本） | ❌ 不接触 | 它只用 `chrome.runtime.sendMessage()` 把文本交给后台，从不读取设置 |
| 你访问的网页自身的 JS | ❌ 无法读取 | content script 运行在**隔离世界（isolated world）**，网页脚本访问不到扩展作用域 |
| 其他浏览器扩展 | ❌ 无法直接读取 | 不同扩展的 `chrome.storage` 相互隔离 |

### 3.7 已知限制（请知悉）

1. **`chrome.storage.local` 不加密。** 任何能访问你电脑文件系统、或能读写你浏览器 Profile 目录的人/程序，都能读到这个 Key。这是所有 Chrome 扩展的通用限制。
2. **Key 会被发送到你配置的 `baseUrl`。** 如果你把 Base URL 改成一个不可信的地址（比如第三方中转、免费代理），你的 Key 就会交给对方。请只填写你信任的服务商地址。
3. **建议为插件单独申请一把 Key**，并设置用量上限/额度告警。这样即使出问题，影响也可控。
4. `manifest.json` 申请了 `host_permissions: <all_urls>`，这是「整页翻译」功能所必需的。但它只用于读取页面文本；**Key 的读写全部在后台与面板完成**，注入脚本不参与。

---

## 四、贡献者须知（防止把 Key 提交进仓库）

### 4.1 绝对不要提交密钥

`.gitignore` 已经忽略了以下内容，请勿用 `git add -f` 强行绕过：

```
.env
.env.local
```

### 4.2 本地跑 API 测试时用环境变量注入

`scripts/test-api.mjs` 从环境变量读取凭据，**不要把它写回源码**：

```bash
# macOS / Linux
KELI_API_KEY=sk-xxx KELI_BASE_URL=https://api.deepseek.com node scripts/test-api.mjs

# Windows PowerShell
$env:KELI_API_KEY="sk-xxx"; node scripts/test-api.mjs
```

### 4.3 提交前跑一次本地扫描

```bash
bash .github/scripts/secret-scan.sh
```

它会同时扫描**工作区**和**全部 git 历史**，命中则退出码非 0。

### 4.4 CI 自动拦截

`.github/workflows/secret-scan.yml` 会在**每次 push 与 PR** 时自动执行上述脚本，一旦发现疑似真实密钥就会让检查失败，阻止合并。

扫描覆盖的特征包括：OpenAI / DeepSeek / Anthropic 的 `sk-` 系列、AWS `AKIA`/`ASIA`、GitHub `ghp_`/`github_pat_`、Slack `xox*`、Google `AIza`、GitLab `glpat-`、npm token，以及 PEM 私钥块，和 `apiKey = "…"` 这类变量赋值写法。

> 若确为误报（例如文档中的示例串），可在该行尾添加注释 `secret-scan:allow` 豁免。

### 4.5 强烈建议开启 GitHub 原生防护（免费）

本仓库为公开仓库，可免费启用 GitHub 的密钥扫描：

**Settings → Code security → 开启 `Secret scanning` 与 `Push protection`**

`Push protection` 会在推送前就阻断含密钥的提交，是本项目 CI 扫描之外的第二道防线。

---

## 五、如果怀疑 Key 已泄露

按顺序执行，**不要只做第一步**：

1. 立刻到服务商后台**吊销 / 删除**该 Key（这一步最快止血）
2. 重新生成一把新的 Key
3. 在插件「管理面板 → 模型接入」中更新为新 Key
4. **如果该 Key 曾进入 git 历史**：仅仅 `git revert` 或删除文件是**无效的**——历史提交里依然存在。需要重写历史：
   ```bash
   # 推荐 git-filter-repo
   git filter-repo --replace-text <(echo 'sk-***==>REDACTED')
   # 然后强制推送，并通知所有协作者重新克隆
   ```
   并**默认该 Key 已经泄露**，务必完成第 1 步的吊销。
5. 开启「第四节 4.5」中的 Push protection，避免再次发生。

---

*本政策随扩展版本更新，最后修订：v1.1.x*
