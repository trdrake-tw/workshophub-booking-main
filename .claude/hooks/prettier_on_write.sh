#!/usr/bin/env bash
# prettier_on_write — Claude Code PostToolUse hook (Write|Edit).
# Assistive only: formats the file Claude just wrote and never blocks.
# Claude Code passes the tool call as JSON on stdin; there is no $FILE_PATH env var.
#
# WH-13: for .ts/.tsx files that `make lint` covers (api/src, api/tests, app/src),
# it then runs `eslint --fix` on that file and passes any errors that remain back
# to Claude as additionalContext. Prettier runs first and ESLint second, in one
# script, because two hooks on the same matcher run in parallel and would race
# on the file.

FILE_PATH=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
[ -n "$FILE_PATH" ] && [ -f "$FILE_PATH" ] || exit 0

ROOT="${CLAUDE_PROJECT_DIR:-.}"
cd "$ROOT" || exit 0
ROOT=$(pwd -P)

# --no-install: use the repo's pinned prettier, never download one.
# --ignore-unknown: skip file types prettier can't format.
npx --no-install prettier --write --ignore-unknown "$FILE_PATH" \
  >/dev/null 2>&1 || true

ABS_PATH=$(cd "$(dirname "$FILE_PATH")" 2>/dev/null && echo "$(pwd -P)/$(basename "$FILE_PATH")") || exit 0
REL_PATH="${ABS_PATH#"$ROOT"/}"

case "$REL_PATH" in
  api/src/*.ts | api/tests/*.ts) PKG=api ;;
  app/src/*.ts | app/src/*.tsx) PKG=app ;;
  *) exit 0 ;;
esac

# Run from the package so ESLint picks up that package's .eslintrc.cjs and plugins.
# Exit status is 1 when errors remain; the JSON report is what matters.
REPORT=$(cd "$PKG" && npx --no-install eslint --fix --format json "$ABS_PATH" 2>/dev/null) || true
[ -n "$REPORT" ] || exit 0

# Warnings are reported too: api/.eslintrc.cjs sets no-explicit-any to "warn",
# and CLAUDE.md norm 1 (no `any`) should still reach Claude.
PROBLEMS=$(printf '%s' "$REPORT" | jq -r --arg rel "$REL_PATH" '
  [.[].messages[]]
  | map("\($rel):\(.line):\(.column) \(if .severity == 2 then "error" else "warning" end) \(.ruleId // "parse-error") \(.message)")
  | join("\n")' 2>/dev/null) || exit 0
[ -n "$PROBLEMS" ] || exit 0

jq -n --arg problems "$PROBLEMS" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: ("ESLint problems remain after eslint --fix (not blocking; fix them before finishing):\n" + $problems)
  }
}'
exit 0
