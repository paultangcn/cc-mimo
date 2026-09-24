#!/bin/bash
# End-to-end check of a model through claudex-shim with headless Claude Code.
# Usage: scripts/smoke-test.sh <model> [shim-url]
# Needs ANTHROPIC_AUTH_TOKEN set to your gateway client key.
set -uo pipefail
MODEL="${1:?usage: smoke-test.sh <model> [shim-url]}"
BASE="${2:-http://127.0.0.1:8319}"
: "${ANTHROPIC_AUTH_TOKEN:?set ANTHROPIC_AUTH_TOKEN to your gateway client key}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
cd "$WORK" && git init -q && mkdir src
printf 'function add(a, b) {\n  return a - b;\n}\nfunction mul(a, b) {\n  return a * b;\n}\nmodule.exports = { add, mul };\n' > src/calc.js
printf "const assert = require('assert');\nconst { add, mul } = require('./calc');\nassert.strictEqual(add(2, 3), 5);\nassert.strictEqual(mul(2, 3), 6);\nconsole.log('all tests passed');\n" > src/calc.test.js
git add -A && git -c user.name=t -c user.email=t@t commit -qm init

run() { # name prompt
  ANTHROPIC_BASE_URL="$BASE" CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1 \
    claude -p --model "$MODEL" --dangerously-skip-permissions --output-format stream-json --verbose "$2" \
    < /dev/null > "$WORK/$1.jsonl" 2>/dev/null
  local calls errs ok
  calls=$(jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | .name' "$WORK/$1.jsonl" | sort | uniq -c | tr -s ' ' | tr '\n' ' ')
  errs=$(jq -r 'select(.type=="user") | .message.content[]? | select(.type=="tool_result" and .is_error==true) | .content|tostring|.[0:120]' "$WORK/$1.jsonl" | grep -i -E 'api error|unknown provider|refus' | head -2)
  ok=$(jq -r 'select(.type=="result") | .is_error' "$WORK/$1.jsonl")
  if [ "$ok" = "false" ] && [ -z "$errs" ]; then echo "PASS  $1  [$calls]"; else echo "FAIL  $1  [$calls] $errs"; fi
}

run coding  "src/calc.test.js fails. Fix src/calc.js, run node src/calc.test.js until it passes, then git commit -am 'fix add'."
run subagent "Use the Task tool to launch an Explore subagent that finds where mul is defined. Wait for it and report."
run search  "Use WebSearch to find the current Node.js LTS version. Include one source link."
