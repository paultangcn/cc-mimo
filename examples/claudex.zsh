# Add to ~/.zshrc (or ~/.bashrc). `claudex` = Claude Code on your gateway's models.
claudex() {
  ANTHROPIC_BASE_URL=http://127.0.0.1:8319 \
  ANTHROPIC_AUTH_TOKEN=your-cliproxyapi-client-key \
  CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1 \
  CLAUDE_CODE_MAX_CONTEXT_TOKENS=500000 \
  CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=90 \
  claude --model grok-4.7 --dangerously-skip-permissions "$@"
}
# Do NOT add CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1: in team mode SendMessage accepts
# structured payloads, some models then send {"type":"shutdown_request"} objects instead
# of text and cross-session messages fail.
