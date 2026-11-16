#!/usr/bin/env bash
# test_writer_blind — Claude Code PreToolUse hook (Read|Grep|Glob|Write|Edit).
# Keeps the test-writer subagent blind to the implementation:
#   - Read: denied for anything under api/src/.
#   - Grep/Glob: the search root must be inside api/tests, api/prisma or stories.
#   - Write/Edit: the target must be inside api/tests.
# Registered in the test-writer agent's frontmatter, so it only runs inside that
# agent. The agent_type check below is a second guard: calls from the main
# session and other agents carry a different (or no) agent_type and pass through.

INPUT=$(cat)
AGENT=$(jq -r '.agent_type // empty' <<<"$INPUT")
[ "$AGENT" = "test-writer" ] || exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd' <<<"$INPUT")}"
ROOT=$(cd "$ROOT" && pwd -P)
TOOL=$(jq -r '.tool_name' <<<"$INPUT")

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse",
    permissionDecision: "deny", permissionDecisionReason: $r}}'
  exit 0
}

# Resolve a path to its physical absolute form (handles .., symlinks and paths
# that don't exist yet) so "api/tests/../src/routes" can't slip through.
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

FORBIDDEN=("$ROOT/api/src")
SEARCHABLE=("$ROOT/api/tests" "$ROOT/api/prisma" "$ROOT/stories")
WRITABLE="$ROOT/api/tests"

under() { [ "$1" = "$2" ] || [[ "$1" = "$2"/* ]]; }

case "$TOOL" in
  Read)
    TARGET=$(resolve "$(jq -r '.tool_input.file_path // empty' <<<"$INPUT")")
    for f in "${FORBIDDEN[@]}"; do
      under "$TARGET" "$f" && deny "test-writer is blind to the implementation: reading ${TARGET#"$ROOT"/} is not allowed. Derive behaviour from the navigator packet and the story."
    done
    ;;
  Grep|Glob)
    RAW=$(jq -r '.tool_input.path // empty' <<<"$INPUT")
    [ -n "$RAW" ] || deny "test-writer must scope $TOOL with a path inside api/tests, api/prisma or stories."
    TARGET=$(resolve "$RAW")
    # A pattern like "../src/**" or "/abs/**" could escape the search root.
    PAT=$(jq -r '.tool_input.pattern // empty' <<<"$INPUT")
    if [ "$TOOL" = "Glob" ] && { [[ "$PAT" = /* ]] || [[ "$PAT" = *..* ]]; }; then
      deny "test-writer Glob patterns must be relative and may not contain '..'."
    fi
    for s in "${SEARCHABLE[@]}"; do
      under "$TARGET" "$s" && exit 0
    done
    deny "test-writer may only $TOOL inside api/tests, api/prisma or stories (got ${TARGET#"$ROOT"/})."
    ;;
  Write|Edit)
    RAW=$(jq -r '.tool_input.file_path // empty' <<<"$INPUT")
    [ -n "$RAW" ] || deny "test-writer $TOOL needs a file_path inside api/tests."
    TARGET=$(resolve "$RAW")
    under "$TARGET" "$WRITABLE" && exit 0
    deny "test-writer may only $TOOL files inside api/tests (got ${TARGET#"$ROOT"/})."
    ;;
esac
exit 0
