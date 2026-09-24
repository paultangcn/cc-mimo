# cc-mimo

Use [Claude Code](https://code.claude.com) with **Xiaomi MiMo** — no Anthropic subscription needed — with subagents, web search, task lists and long multi-step tool use actually working.

[中文说明](README.zh-CN.md)

```bash
ccmimo              # MiMo v2.6 Pro
ccmimo flash        # MiMo v2.6 Flash
ccmimo grok-4.7     # any other model your gateway serves
ccmimo flash --resume
```

**Platform:** macOS only for now (tested, one-step installer). Linux should work with manual setup but is untested. Windows is not supported yet.

cc-mimo only affects sessions started with `ccmimo`. Your regular `claude` sessions, settings and subscription (if you have one) are untouched.

## Why

Pointing Claude Code at MiMo through a gateway gets you a chat. Using it as a coding agent is where it breaks. cc-mimo is the set of fixes:

| Symptom | Cause | Fix |
|---|---|---|
| MiMo gets slower every step: thinking grows from ~1k to 50k characters, a single step takes 3–6 minutes | The gateway drops MiMo's previous reasoning when converting requests, so it re-derives everything each step (MiMo requires `reasoning_content` to be sent back during tool use) | `is-compat: true` on the MiMo models in CLIProxyAPI |
| `WebSearch` returns nothing, or a literal `<tool_call><function=web_search>…` string | Claude Code's web search is an Anthropic server-side tool; MiMo can't execute it | **cc-mimo-shim** runs the search on MiMo's native web search plugin and returns the sources as real search results, with links |
| Every subagent dies with `400 unknown provider for model claude-…` | Something asked for a Claude model the gateway doesn't have | Subagents follow the session's model (Claude Code's own default, enforced by `ccmimo`); other models are called **by name** through agents; the shim maps any leftover Claude model name back to the session's model |
| The model says it has no `TaskCreate` / `TaskList` | Claude Code hides task tools for models it doesn't recognize | `ccmimo` turns them on |
| `… isn't described by this version's model catalog … within 200k tokens` | Claude Code doesn't know the model's context window | `ccmimo` sets 500k, auto-compact at 90% (configurable) |
| A session stops auto-compacting and grows past the limit (status bar at 100%) | It was switched via the `/model` picker to one of CLIProxyAPI's `claude-…` discovery aliases; Claude Code then ignores the context/compaction settings | `ccmimo` turns gateway model discovery off. Switch models by real name: `/model mimo-v2.6-flash` |
| Cross-session `SendMessage` fails (`structured messages cannot be sent cross-session`) | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` lets models send objects instead of text | `ccmimo` unsets it. Don't `--resume` a session whose history already contains the bad calls |

```
claude (via ccmimo) ──► cc-mimo-shim :8319 ──► CLIProxyAPI :8317 ──► MiMo / Grok / GPT / …
                          └─ web search ──► MiMo native web search
```

## What you get without a Claude subscription

Everything in Claude Code that doesn't need a claude.ai login: reading/editing files, shell, subagents (Explore, Plan, general-purpose, your own), web search and fetch, images, task lists, plan mode, questions, skills, workflows, scheduled/background work, cross-session messages, worktrees.

Not available (they need a claude.ai login): claude.ai connectors, Remote Control, publishing Artifacts.

## Requirements

- Claude Code (tested with 2.1.281)
- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) with your MiMo key (tested with 7.2.145). Required: MiMo's own Anthropic-compatible endpoint did not work reliably with Claude Code in our use.
- Node.js 18+ (no npm dependencies), `jq` for the smoke test
- macOS for the bundled installer; on Linux run `node shim/server.js` under systemd and put `bin/ccmimo` on your PATH

## Setup

1. **CLIProxyAPI.** Add MiMo as in [`examples/cliproxyapi-snippet.yaml`](examples/cliproxyapi-snippet.yaml) — keep `is-compat: true` on both models.
2. **Install.** `scripts/install-macos.sh` — first run creates `~/.config/cc-mimo/config.sh` and `~/.config/cc-mimo/shim.json`; fill in your CLIProxyAPI client key and run it again. It installs the shim as a login service (log: `~/Library/Logs/cc-mimo-shim.log`) and links `ccmimo` into `~/.local/bin`.
3. **Check.** `scripts/smoke-test.sh` (optionally with a model, e.g. `scripts/smoke-test.sh flash`):

```
PASS  coding  [ 2 Bash  1 Edit  2 Read ]
PASS  subagent  [ 1 Agent(general-purpose)  3 Bash  1 Read ]
PASS  named  [ 1 Agent(mimo-flash) ]
PASS  tasks  [ 2 TaskCreate  1 TaskList ]
PASS  search  [ 1 WebSearch ]
```

Uninstall: `scripts/install-macos.sh --uninstall`.

## Models and agents

**Layer 1 — MiMo.** `ccmimo` starts on `mimo-v2.6-pro`; `ccmimo flash` on `mimo-v2.6-flash`. Subagents run on the session's model unless the model hands work to a specific one by name: `mimo-pro` and `mimo-flash` are available as agents in every `ccmimo` session (e.g. a Pro session can give quick lookups to `mimo-flash`).

**Layer 2 — other models (example: Grok).**
1. Make CLIProxyAPI serve it (API key or one of its OAuth logins) — see the `xai` block in the snippet.
2. It already works as `ccmimo grok-4.7`. To add a shortcut and let other sessions call it by name, edit `~/.config/cc-mimo/config.sh`:

```bash
CCMIMO_SHORTCUTS="pro=mimo-v2.6-pro flash=mimo-v2.6-flash grok=grok-4.7"
CCMIMO_AGENTS="mimo-pro=mimo-v2.6-pro mimo-flash=mimo-v2.6-flash grok=grok-4.7"
```

Web search for non-MiMo models goes through CLIProxyAPI as usual.

## Checking your MiMo quota (optional)

MiMo has no public quota API, but the platform console reads it from two endpoints you can call yourself with your console login cookie:

- `GET https://platform.xiaomimimo.com/api/v1/tokenPlan/usage` — tokens used / limit (`data.usage.items[name=plan_total_token]`)
- `GET https://platform.xiaomimimo.com/api/v1/tokenPlan/detail` — plan and `currentPeriodEnd`

To get the cookie without digging through headers: open the console's Token Plan page in your browser, open the web inspector's Network tab, reload, and export the requests as a `.har` file. Then:

```bash
jq -r '[.log.entries[] | select(.request.url|test("tokenPlan/usage"))][0].request.headers[] | select(.name|test("^cookie$";"i")).value' platform.xiaomimimo.com.har > ~/.config/cc-mimo/mimo-console-cookie
chmod 600 ~/.config/cc-mimo/mimo-console-cookie
curl -s https://platform.xiaomimimo.com/api/v1/tokenPlan/usage -H "Cookie: $(cat ~/.config/cc-mimo/mimo-console-cookie)"
```

From there you can show it in a Claude Code `statusLine` script (cache the result; don't query on every render). The cookie is your Xiaomi account login: keep it private, delete the `.har` afterwards, and re-export when it expires. These are undocumented console endpoints and may change.

## Configuration

`~/.config/cc-mimo/config.sh` (read by `ccmimo`, see [`examples/config.sh`](examples/config.sh)):

| Variable | Default | |
|---|---|---|
| `CCMIMO_API_KEY` | — | Client key your CLIProxyAPI accepts |
| `CCMIMO_GATEWAY_URL` | `http://127.0.0.1:8319` | cc-mimo-shim |
| `CCMIMO_DEFAULT_MODEL` | `mimo-v2.6-pro` | |
| `CCMIMO_SHORTCUTS` | `pro=… flash=…` | `ccmimo <shortcut>` |
| `CCMIMO_AGENTS` | `mimo-pro=… mimo-flash=…` | Agents callable by name, `name=model` |
| `CCMIMO_CONTEXT_TOKENS` / `CCMIMO_COMPACT_PCT` | `500000` / `90` | |
| `CCMIMO_CLAUDE_ARGS` | empty | Extra `claude` flags, e.g. `--dangerously-skip-permissions` |

`~/.config/cc-mimo/shim.json` (read by the shim, see [`examples/shim.json`](examples/shim.json)): listen port, CLIProxyAPI address and client key, and where the native web search goes — `fromCliProxyAPI` reuses the MiMo key from your CLIProxyAPI config so it lives in one place, or set `baseUrl` + `apiKey`/`apiKeyEnv`.

## How the shim works

- **Web search.** A request carrying Claude Code's `web_search_*` tool for a MiMo model is answered by the shim: one call to MiMo with `tools: [{"type":"web_search"}]`, its `url_citation` annotations turned into `web_search_tool_result` blocks (streamed or not).
- **Claude model names.** A request for a `claude-*` model the gateway doesn't serve is sent with the model the same session's main thread is using (Claude Code's `x-claude-code-session-id` header; remembered across restarts). If the session is unknown, the request is refused — never silently routed to a different model. Models the gateway does serve, including CLIProxyAPI's `claude-…` discovery aliases, pass through untouched.
- **Everything else** is forwarded byte for byte. One log line per request (model, main/subagent, server tools, effort) so you can see which layer misbehaves.

## Caveats

- Relies on Claude Code request headers that are not a documented API; a Claude Code update may need a shim update.
- The shim fixes plumbing, not judgment: model quality is the model's.

## License

MIT
