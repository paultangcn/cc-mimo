# claudex

Run [Claude Code](https://code.claude.com) on non-Anthropic models (Grok, GPT, Xiaomi MiMo, …) through [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) — with subagents, web search and multi-step tool use actually working.

[中文说明](README.zh-CN.md)

Pointing `ANTHROPIC_BASE_URL` at a gateway gets you a chat that runs. Using it as a coding agent is where things break: subagents fail, web search does nothing, some models slow to a crawl after a few steps. claudex is the set of fixes for that: a small pass-through layer (`claudex-shim`), a few gateway settings, and a launcher.

```
Claude Code ──► claudex-shim :8319 ──► CLIProxyAPI :8317 ──► xAI / OpenAI / MiMo / …
                  │
                  └─ native web search ──► provider (e.g. MiMo) directly
```

## What breaks, and what fixes it

| Symptom | Cause | Fix |
|---|---|---|
| Every subagent / Explore agent dies with `400 unknown provider for model claude-sonnet-5` (or haiku/opus) | Subagents and helpers request Claude models; the gateway serves none | **shim** rewrites them to the model the session's main thread uses — a Grok session spawns Grok subagents, a MiMo session spawns MiMo. Unknown session → the request is refused, never silently routed to another model |
| `WebSearch` returns nothing, or a literal `<tool_call><function=web_search>…` string | `web_search_*` is an Anthropic server-side tool; the gateway forwards it as a plain function the model can't execute | **shim** runs the search on the provider's own web search (MiMo's `{"type":"web_search"}` plugin) and returns the citations as real search results, so source links show up |
| MiMo gets slower every step: thinking grows 1k → 50k characters, one step takes 3–6 minutes, the screen doesn't move for half an hour | CLIProxyAPI drops unsigned thinking blocks when converting Claude → OpenAI, so the model never gets its previous `reasoning_content` back and re-derives everything each step | **gateway**: `is-compat: true` on the model (see [`examples/cliproxyapi-snippet.yaml`](examples/cliproxyapi-snippet.yaml)). Steps drop back to seconds |
| `"grok-4.7" isn't described by this version's model catalog … keeps this session within 200k tokens` | Claude Code doesn't know the model's window | **launcher**: `CLAUDE_CODE_MAX_CONTEXT_TOKENS` + `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` |
| The model says it has no `TaskCreate` / `TaskList` / `TaskUpdate` | Claude Code only enables the task tools for models it recognizes | **launcher**: `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` |
| Cross-session `SendMessage` fails with `structured messages cannot be sent cross-session` | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` makes SendMessage accept objects; some models then send `{"type":"shutdown_request"}` | **launcher**: don't set that flag (and don't `--resume` a session whose history already contains the bad calls) |

Everything else passes through byte for byte.

## Requirements

- Claude Code (tested with 2.1.281)
- CLIProxyAPI with your providers configured (tested with 7.2.145)
- Node.js 18+ (no npm dependencies)
- macOS for the bundled service installer; on Linux run `node shim/server.js` under systemd or similar

## Setup

1. **Gateway.** Merge the relevant parts of [`examples/cliproxyapi-snippet.yaml`](examples/cliproxyapi-snippet.yaml) into your CLIProxyAPI config — at minimum `is-compat: true` for MiMo models.
2. **Shim config.** Copy [`examples/shim.json`](examples/shim.json) to `~/.config/claudex/shim.json` and set `upstreamApiKey` to a client key your CLIProxyAPI accepts. For native search, either point `fromCliProxyAPI` at your CLIProxyAPI config and provider name (the key stays in one place), or give `baseUrl` + `apiKey` / `apiKeyEnv` directly.
3. **Service.** `scripts/install-macos.sh` — runs the shim at login and restarts it if it dies. Logs: `~/Library/Logs/claudex-shim.log`. Uninstall: `scripts/install-macos.sh --uninstall`.
4. **Launcher.** Add the `claudex` function from [`examples/claudex.zsh`](examples/claudex.zsh) to your shell rc. Switch models inside with `/model`.
5. **Check.** `ANTHROPIC_AUTH_TOKEN=<client key> scripts/smoke-test.sh <model>` runs a coding task, a subagent and a web search headlessly:

```
== mimo-v2.6-pro
PASS  coding  [ 2 Bash  1 Edit  2 Read ]
PASS  subagent  [ 1 Agent  4 Bash  1 Read ]
PASS  search  [ 1 WebSearch ]
```

## Shim config reference

| Key | Default | Meaning |
|---|---|---|
| `listen.host` / `listen.port` | `127.0.0.1` / `8319` | Where Claude Code connects (`ANTHROPIC_BASE_URL`) |
| `upstream` | `http://127.0.0.1:8317` | Your CLIProxyAPI |
| `upstreamApiKey` | — | Client key used to list the gateway's models |
| `stateFile` | `~/.local/state/claudex/session-models.json` | Remembers each session's model across shim restarts |
| `nativeWebSearch[]` | `[]` | `models` (regex on the real model name) + endpoint: `fromCliProxyAPI: {config, provider}` or `baseUrl` + `apiKey`/`apiKeyEnv`. The endpoint must accept OpenAI-style `tools: [{"type":"web_search"}]` and return `message.annotations[].url_citation` (MiMo does) |

The config path can be overridden with `CLAUDEX_SHIM_CONFIG`.

## How it works

- **Session model.** Claude Code sends `x-claude-code-session-id` on every request and `x-claude-code-agent-id` on subagent requests. The shim records the model of each session's main-thread requests and uses it for that session's `claude-*` requests. Model ids the gateway itself serves (CLIProxyAPI's `claude-…-dd-…` discovery aliases) are left alone.
- **Search.** A request carrying a `web_search_*` tool for a matching model is answered by the shim: one OpenAI-style call with the provider's web search tool, converted into `server_tool_use` + `web_search_tool_result` + text blocks (streamed or not).
- **Log.** One line per request: model, main/subagent, server tools, effort; plus every model rewrite and search. When something misbehaves, the log tells you which layer.

## Caveats

- Relies on Claude Code request headers that are not a documented API; a Claude Code update may need a shim update.
- Model quality is the model's. The shim fixes plumbing, not judgment (e.g. a model searching for last year's edition of something).

## License

MIT
