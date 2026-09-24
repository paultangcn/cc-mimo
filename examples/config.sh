# ~/.config/cc-mimo/config.sh — read by `ccmimo` on every launch (plain bash).

# Where Claude Code connects: cc-mimo-shim, which sits in front of CLIProxyAPI.
CCMIMO_GATEWAY_URL=http://127.0.0.1:8319
# A client key your CLIProxyAPI accepts (its `api-keys:` list).
CCMIMO_API_KEY=your-cliproxyapi-client-key

# Model used when you just type `ccmimo`.
CCMIMO_DEFAULT_MODEL=mimo-v2.6-pro
# Shortcuts for `ccmimo <shortcut>`. Any full model id your gateway serves works too.
CCMIMO_SHORTCUTS="pro=mimo-v2.6-pro flash=mimo-v2.6-flash"
# Agents the model can call by name to hand a subtask to a specific model ("name=model").
# Without naming one, subagents run on the session's own model.
CCMIMO_AGENTS="mimo-pro=mimo-v2.6-pro mimo-flash=mimo-v2.6-flash"

# Context window Claude Code assumes for these models, and when to auto-compact.
CCMIMO_CONTEXT_TOKENS=500000
CCMIMO_COMPACT_PCT=90

# Extra flags passed to `claude` on every launch, e.g. --dangerously-skip-permissions
CCMIMO_CLAUDE_ARGS=""

# --- Adding another model (example: Grok) ---------------------------------------
# 1. Make CLIProxyAPI serve it (see examples/cliproxyapi-snippet.yaml).
# 2. Optional shortcut and callable agent:
# CCMIMO_SHORTCUTS="pro=mimo-v2.6-pro flash=mimo-v2.6-flash grok=grok-4.7"
# CCMIMO_AGENTS="mimo-pro=mimo-v2.6-pro mimo-flash=mimo-v2.6-flash grok=grok-4.7"
