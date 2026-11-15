#!/usr/bin/env bash
# implementer_guard — Claude Code PreToolUse hook (Write|Edit|Bash).
# Keeps the implementer subagent from changing the tests it has to pass:
#   - Write/Edit: the target must be inside api/src or api/prisma.
#   - Bash: denied for commands that modify files under tests/, reset the
#     database, bypass git hooks, or commit/push. This is a best-effort pattern
#     match on the command text, not a sandbox.
# Registered in the implementer agent's frontmatter, so it only runs inside that
# agent. The agent_type check below is a second guard: calls from the main
# session and other agents carry a different (or no) agent_type and pass through.

INPUT=$(cat)
AGENT=$(jq -r '.agent_type // empty' <<<"$INPUT")
[ "$AGENT" = "implementer" ] || exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd' <<<"$INPUT")}"
ROOT=$(cd "$ROOT" && pwd -P)
TOOL=$(jq -r '.tool_name' <<<"$INPUT")

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse",
    permissionDecision: "deny", permissionDecisionReason: $r}}'
  exit 0
}

# Resolve a path to its physical absolute form (handles .., symlinks and paths
# that don't exist yet) so "api/src/../tests/x.test.ts" can't slip through.
resolve() {
  local p="$1"
  [[ "$p" = /* ]] || p="$ROOT/$p"
  local dir="$p" rest=""
  while [ ! -d "$dir" ]; do
    rest="/$(basename "$dir")$rest"
    dir=$(dirname "$dir")
  done
  echo "$(cd "$dir" && pwd -P)$rest"
}

WRITABLE=("$ROOT/api/src" "$ROOT/api/prisma")

under() { [ "$1" = "$2" ] || [[ "$1" = "$2"/* ]]; }

case "$TOOL" in
  Write|Edit)
    RAW=$(jq -r '.tool_input.file_path // empty' <<<"$INPUT")
    [ -n "$RAW" ] || deny "implementer $TOOL needs a file_path inside api/src or api/prisma."
    TARGET=$(resolve "$RAW")
    for w in "${WRITABLE[@]}"; do
      under "$TARGET" "$w" && exit 0
    done
    deny "implementer may only $TOOL files inside api/src or api/prisma (got ${TARGET#"$ROOT"/}). Tests and config are not yours to change: if a test is wrong, stop and report it."
    ;;
  Bash)
    CMD=$(jq -r '.tool_input.command // empty' <<<"$INPUT")
    # A file-modifying command (or a redirect) aimed at a path under tests/.
    MODIFY='(^|[^[:alnum:]_-])(rm|mv|cp|tee|truncate|touch|chmod|ln|dd|patch|sed[[:space:]]+(-[[:alnum:]]+[[:space:]]+)*-[[:alnum:]]*i|perl[[:space:]]+-[[:alnum:]]*i|git[[:space:]]+(checkout|restore|rm|mv|stash|apply|reset))[^|;&]*(^|[^[:alnum:]_.-])tests(/|[[:space:]]|$)'
    REDIRECT='>[>|]?[[:space:]]*[^[:space:]|;&]*(^|[^[:alnum:]_.-])tests/'
    if [[ "$CMD" =~ $MODIFY ]] || [[ "$CMD" =~ $REDIRECT ]]; then
      deny "implementer may not modify files under api/tests from Bash. If a test is wrong, stop and report it."
    fi
    if [[ "$CMD" =~ (reset-db|migrate[[:space:]]+reset|db[[:space:]]+push.*--force-reset) ]]; then
      deny "implementer may not reset the database. Report that a reset is needed and let the caller run it."
    fi
    if [[ "$CMD" =~ (--no-verify|HUSKY=0) ]]; then
      deny "implementer may not bypass git hooks."
    fi
    if [[ "$CMD" =~ (^|[^[:alnum:]_-])git[[:space:]]+(commit|push)([[:space:]]|$) ]]; then
      deny "implementer does not commit or push. Stop when make test is green and report."
    fi
    ;;
esac
exit 0
