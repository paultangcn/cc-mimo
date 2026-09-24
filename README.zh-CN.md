# cc-mimo

用**小米 MiMo** 跑 [Claude Code](https://code.claude.com)，不需要 Anthropic 订阅，子 agent、联网搜索、任务清单、长时间多步工具调用都能正常工作。

[English](README.md)

```bash
ccmimo              # MiMo v2.6 Pro
ccmimo flash        # MiMo v2.6 Flash
ccmimo grok-4.7     # 网关里有的任何其他模型
ccmimo flash --resume
```

cc-mimo 只作用于用 `ccmimo` 启动的会话。你平时的 `claude` 会话、设置和订阅（如果有）都不受影响。

## 为什么需要

让 Claude Code 通过网关连 MiMo，能聊天；但当 coding agent 用就会出问题。cc-mimo 是这些问题的修法：

| 现象 | 原因 | 修法 |
|---|---|---|
| MiMo 越走越慢：思考量从 1 千字涨到 5 万字，一步 3–6 分钟 | 网关转格式时丢掉了 MiMo 之前的思考，它每一步都要从头再推一遍（小米要求工具调用时把 `reasoning_content` 传回去） | CLIProxyAPI 里给 MiMo 模型加 `is-compat: true` |
| `WebSearch` 没结果，或只回一段 `<tool_call><function=web_search>…` 文字 | Claude Code 的联网搜索是 Anthropic 服务端工具，MiMo 执行不了 | **cc-mimo-shim** 改用 MiMo 自带的联网插件，把来源转成真正的搜索结果，带链接 |
| 派子 agent 全部报 `400 unknown provider for model claude-…` | 有东西请求了网关里没有的 Claude 模型 | 子 agent 跟主会话用同一个模型（Claude Code 的默认规则，由 `ccmimo` 保证）；要用别的模型就**点名**对应的 agent；剩下请求 Claude 模型名的，由 shim 换回主会话的模型 |
| 模型说自己没有 `TaskCreate` / `TaskList` | Claude Code 对它不认识的模型隐藏任务工具 | `ccmimo` 把它们打开 |
| 提示 `… isn't described by this version's model catalog … within 200k tokens` | Claude Code 不知道模型的上下文长度 | `ccmimo` 设为 50 万，用到 90% 自动压缩（可改） |
| 跨会话 `SendMessage` 报 `structured messages cannot be sent cross-session` | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 会让模型发对象而不是文字 | `ccmimo` 会去掉这个开关；也不要 `--resume` 历史里已经有错误调用的会话 |

```
claude（经 ccmimo）──► cc-mimo-shim :8319 ──► CLIProxyAPI :8317 ──► MiMo / Grok / GPT / …
                          └─ 联网搜索 ──► MiMo 原生联网插件
```

## 不订阅 Claude 能用到什么

Claude Code 里所有不需要登录 claude.ai 的功能：读写文件、命令行、子 agent（Explore、Plan、general-purpose 和你自己定义的）、联网搜索和抓网页、看图、任务清单、计划模式、向你提问、Skill、Workflow、定时和后台任务、跨会话消息、worktree。

用不了的（需要登录 claude.ai）：claude.ai 连接器、手机远程（Remote Control）、发布 Artifact。

## 环境

- Claude Code（测试版本 2.1.281）
- 配好 MiMo key 的 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)（测试版本 7.2.145）。这是必需的：我们实际使用中，MiMo 自己的 Anthropic 兼容接口没法可靠地配合 Claude Code 工作。
- Node.js 18+（无 npm 依赖），自检脚本需要 `jq`
- 自带安装脚本用于 macOS；Linux 用 systemd 运行 `node shim/server.js`，并把 `bin/ccmimo` 放进 PATH

## 安装

1. **CLIProxyAPI**：按 [`examples/cliproxyapi-snippet.yaml`](examples/cliproxyapi-snippet.yaml) 添加 MiMo，两个模型都保留 `is-compat: true`。
2. **安装**：运行 `scripts/install-macos.sh`。第一次运行会生成 `~/.config/cc-mimo/config.sh` 和 `~/.config/cc-mimo/shim.json`，填好 CLIProxyAPI 的客户端 key 后再运行一次。它会把 shim 装成开机自启的服务（日志 `~/Library/Logs/cc-mimo-shim.log`），并把 `ccmimo` 链接到 `~/.local/bin`。
3. **自检**：`scripts/smoke-test.sh`（可带模型，如 `scripts/smoke-test.sh flash`），会跑改代码、子 agent、点名 agent、任务工具、联网搜索五项。

卸载：`scripts/install-macos.sh --uninstall`。

## 模型和 agent

**第 1 层：MiMo。** `ccmimo` 默认用 `mimo-v2.6-pro`，`ccmimo flash` 用 `mimo-v2.6-flash`。子 agent 默认跟主会话用同一个模型；模型也可以点名把活交给特定模型：每个 `ccmimo` 会话里都有 `mimo-pro`、`mimo-flash` 两个 agent，比如 Pro 会话可以把简单的查找交给 `mimo-flash`。

**第 2 层：其他模型（以 Grok 为例）。**
1. 让 CLIProxyAPI 能提供这个模型（API key 或它支持的 OAuth 登录），参考示例里的 `xai` 部分。
2. 这时 `ccmimo grok-4.7` 就能用了。想加简写、并让其他会话能点名它，编辑 `~/.config/cc-mimo/config.sh`：

```bash
CCMIMO_SHORTCUTS="pro=mimo-v2.6-pro flash=mimo-v2.6-flash grok=grok-4.7"
CCMIMO_AGENTS="mimo-pro=mimo-v2.6-pro mimo-flash=mimo-v2.6-flash grok=grok-4.7"
```

非 MiMo 模型的联网搜索照常走 CLIProxyAPI。

## 配置

`~/.config/cc-mimo/config.sh`（`ccmimo` 读取，见 [`examples/config.sh`](examples/config.sh)）：客户端 key、默认模型、简写、可点名的 agent、上下文长度和压缩比例、额外的 `claude` 参数（例如 `--dangerously-skip-permissions`）。

`~/.config/cc-mimo/shim.json`（shim 读取，见 [`examples/shim.json`](examples/shim.json)）：监听端口、CLIProxyAPI 地址和 key、联网搜索发往哪里。`fromCliProxyAPI` 会直接复用你 CLIProxyAPI 配置里的 MiMo key，key 只保存在一处。

## 注意

- 依赖 Claude Code 的请求头（非公开 API），Claude Code 升级后 shim 可能需要跟着改。
- shim 只修链路，不修判断：模型能力归模型本身。

## 许可

MIT
