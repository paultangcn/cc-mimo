# claudex

通过 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 让 [Claude Code](https://code.claude.com) 跑非 Anthropic 模型（Grok、GPT、小米 MiMo 等），并且子 agent、联网搜索、多步工具调用都能正常工作。

[English](README.md)

把 `ANTHROPIC_BASE_URL` 指向网关，能聊天；但当 coding agent 用就会出问题：子 agent 全部失败、搜索没结果、有的模型走几步就越来越慢。claudex 是这些问题的一套修法：一个很薄的转发层（`claudex-shim`）、几项网关设置和一个启动命令。

```
Claude Code ──► claudex-shim :8319 ──► CLIProxyAPI :8317 ──► xAI / OpenAI / MiMo / …
                  │
                  └─ 原生联网搜索 ──► 模型厂商（如小米）直连
```

## 问题与修法

| 现象 | 原因 | 修法 |
|---|---|---|
| 派子 agent / Explore 全部报 `400 unknown provider for model claude-sonnet-5`（或 haiku/opus） | 子 agent 和后台辅助请求默认用 Claude 模型名，网关里没有 | **shim** 改成这个会话主线正在用的模型：Grok 会话派 Grok，MiMo 会话派 MiMo。查不到会话模型时直接拒绝，绝不悄悄换成别的模型 |
| `WebSearch` 没结果，或者只回一段 `<tool_call><function=web_search>…` 文字 | `web_search_*` 是 Anthropic 服务端工具，网关把它当普通函数转给模型，模型执行不了 | **shim** 改用厂商自带的联网搜索（MiMo 的 `{"type":"web_search"}` 插件），把引用转成真正的搜索结果，来源链接能显示出来 |
| MiMo 越走越慢：思考量从 1 千字涨到 5 万字，一步 3–6 分钟，页面半小时不动 | CLIProxyAPI 把 Claude 格式转成 OpenAI 格式时丢掉了没有签名的思考内容，模型拿不回之前的 `reasoning_content`，每一步都从头重推 | **网关**：给模型加 `is-compat: true`（见 [`examples/cliproxyapi-snippet.yaml`](examples/cliproxyapi-snippet.yaml)），每步回到几秒 |
| 提示 `"grok-4.7" isn't described by this version's model catalog … within 200k tokens` | Claude Code 不认识模型的上下文长度 | **启动命令**：`CLAUDE_CODE_MAX_CONTEXT_TOKENS` + `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` |
| 跨会话 `SendMessage` 报 `structured messages cannot be sent cross-session` | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 让 SendMessage 接受对象，有的模型就发 `{"type":"shutdown_request"}` | **启动命令**：不要设这个开关；也不要 `--resume` 历史里已经有错误调用的会话 |

其他请求原样转发。

## 环境

- Claude Code（测试版本 2.1.281）
- 已配置好各家模型的 CLIProxyAPI（测试版本 7.2.145）
- Node.js 18+（无 npm 依赖）
- 自带的服务安装脚本用于 macOS；Linux 用 systemd 等运行 `node shim/server.js`

## 安装

1. **网关**：把 [`examples/cliproxyapi-snippet.yaml`](examples/cliproxyapi-snippet.yaml) 的相关部分合进你的 CLIProxyAPI 配置，至少给 MiMo 模型加上 `is-compat: true`。
2. **shim 配置**：复制 [`examples/shim.json`](examples/shim.json) 到 `~/.config/claudex/shim.json`，`upstreamApiKey` 填 CLIProxyAPI 接受的客户端 key。原生搜索可以用 `fromCliProxyAPI` 指向你的 CLIProxyAPI 配置和厂商名（key 只保存在一处），也可以直接填 `baseUrl` + `apiKey` / `apiKeyEnv`。
3. **服务**：运行 `scripts/install-macos.sh`，开机自动启动，挂了自动重启。日志在 `~/Library/Logs/claudex-shim.log`。卸载：`scripts/install-macos.sh --uninstall`。
4. **启动命令**：把 [`examples/claudex.zsh`](examples/claudex.zsh) 里的 `claudex` 函数加进 shell 配置。进入后用 `/model` 切换模型。
5. **验证**：`ANTHROPIC_AUTH_TOKEN=<客户端 key> scripts/smoke-test.sh <模型>`，会无界面跑一次编码任务、一次子 agent、一次联网搜索。

## 注意

- 依赖 Claude Code 的请求头（非公开 API），Claude Code 升级后 shim 可能需要跟着改。
- 模型能力归模型本身。shim 只修链路，不修判断（比如模型自己把搜索关键词的年份写错）。

## 许可

MIT
