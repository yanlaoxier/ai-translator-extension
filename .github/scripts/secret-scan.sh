#!/usr/bin/env bash
#
# 课利译 · 密钥泄露扫描
# ---------------------------------------------------------------------------
# 检查「工作区」与「全部 git 历史」中是否出现真实可用的 API Key / Token / 私钥。
#
# 本地预检（提交前跑一次，很便宜）：
#     bash .github/scripts/secret-scan.sh
#
# CI 中由 .github/workflows/secret-scan.yml 自动调用。
#
# 命中后如何处理：
#     1) 从文件里删掉
#     2) 到服务商后台「吊销」该密钥并重新生成
#     3) 用环境变量注入，不要把明文写回文件
#     4) 如果已经进了 git 历史，删文件是不够的，需要重写历史（见 SECURITY.md）
# ---------------------------------------------------------------------------

set -uo pipefail

# 统一在仓库根目录执行
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

# ---------------------------------------------------------------------------
# 一、密钥特征
# ---------------------------------------------------------------------------
PATTERNS=(
  'sk-[A-Za-z0-9]{20,}'                 # OpenAI / DeepSeek / 各类兼容协议
  'sk-proj-[A-Za-z0-9_-]{20,}'          # OpenAI project key
  'sk-ant-[A-Za-z0-9_-]{20,}'           # Anthropic
  'AKIA[0-9A-Z]{16}'                    # AWS Access Key ID
  'ASIA[0-9A-Z]{16}'                    # AWS 临时凭证
  'gh[pousr]_[A-Za-z0-9]{36,}'          # GitHub token
  'github_pat_[A-Za-z0-9_]{40,}'        # GitHub fine-grained PAT
  'xox[baprs]-[A-Za-z0-9-]{10,}'        # Slack
  'AIza[0-9A-Za-z_-]{35}'               # Google API key
  'glpat-[A-Za-z0-9_-]{20,}'            # GitLab PAT
  'npm_[A-Za-z0-9]{36,}'                # npm token
)

# 变量赋值写法：apiKey = "一长串字符"
QUOTES="['\"]"
PATTERNS+=(
  "(api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|passwd|password)[[:space:]]*[:=][[:space:]]*${QUOTES}[A-Za-z0-9_/+=.-]{24,}${QUOTES}"
)

# PEM 私钥块（单独检测，因为含空格与横线）
PEM_PATTERN='-----BEGIN [A-Z ]*PRIVATE KEY-----'

# 合并成一条 ERE
COMBINED="$(printf '%s|' "${PATTERNS[@]}")"
COMBINED="(${COMBINED}${PEM_PATTERN})"

# ---------------------------------------------------------------------------
# 二、白名单：占位符 / 文档示例 / 显式豁免
#    - sk-demo-1234567890        本项目 test/preview.html 里的假值
#    - secret-scan:allow         行内豁免标记，谨慎使用
# ---------------------------------------------------------------------------
ALLOW='sk-demo|sk-test|sk-xxx|sk-your|sk-1234567890|YOUR_API_KEY|PLACEHOLDER|REDACTED|changeme|example\.com|secret-scan:allow'

# ---------------------------------------------------------------------------
# 三、执行扫描
# ---------------------------------------------------------------------------
filter_allow() {
  # 读入 grep 命中行，剔除白名单
  grep -vEi "$ALLOW" || true
}

FAIL=0
FOUND=""

echo "════════════════════════════════════════════════════════"
echo " 课利译 · 密钥泄露扫描"
echo "════════════════════════════════════════════════════════"

# --- 3.1 工作区（git 跟踪的文件） ---
echo
echo "▶ [1/2] 扫描工作区（git 跟踪文件）"
TREE_HITS="$(git grep -nEI -e "$COMBINED" -- . 2>/dev/null | filter_allow)"
if [ -n "$TREE_HITS" ]; then
  echo "$TREE_HITS"
  FOUND="${FOUND}${TREE_HITS}"$'\n'
  FAIL=1
else
  echo "  ✔ 未发现可疑密钥"
fi

# --- 3.2 全部 git 历史 ---
echo
echo "▶ [2/2] 扫描全部 git 历史"
COMMIT_COUNT="$(git rev-list --all --count 2>/dev/null || echo 0)"
echo "  共 ${COMMIT_COUNT} 个提交"
HIST_HITS=""
while IFS= read -r commit; do
  hit="$(git grep -nEI -e "$COMBINED" "$commit" -- . 2>/dev/null | filter_allow)"
  if [ -n "$hit" ]; then
    HIST_HITS="${HIST_HITS}${hit}"$'\n'
  fi
done < <(git rev-list --all 2>/dev/null)

if [ -n "${HIST_HITS// /}" ]; then
  echo "$HIST_HITS"
  FOUND="${FOUND}${HIST_HITS}"$'\n'
  FAIL=1
else
  echo "  ✔ 未发现可疑密钥"
fi

# ---------------------------------------------------------------------------
# 四、结论
# ---------------------------------------------------------------------------
echo
echo "════════════════════════════════════════════════════════"
if [ "$FAIL" -ne 0 ]; then
  echo "❌ 扫描失败：检测到疑似真实密钥"
  echo
  echo "处理步骤："
  echo "  1. 从文件中删除该密钥"
  echo "  2. 到服务商后台吊销该密钥并重新生成"
  echo "  3. 改用环境变量注入（如 KELI_API_KEY）"
  echo "  4. 若已进入 git 历史，需重写历史后再强推，详见 SECURITY.md"
  echo
  echo "如果该命中为误报，可在行尾加注释 secret-scan:allow 豁免。"
  exit 1
fi

echo "✅ 扫描通过：工作区与 git 历史中均未发现真实密钥"
exit 0
