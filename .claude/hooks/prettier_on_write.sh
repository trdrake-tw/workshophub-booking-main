#!/usr/bin/env bash
# prettier_on_write — Claude Code PostToolUse hook (Write|Edit).
# Assistive only: formats the file Claude just wrote and never blocks.
# Claude Code passes the tool call as JSON on stdin; there is no $FILE_PATH env var.

FILE_PATH=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
[ -n "$FILE_PATH" ] && [ -f "$FILE_PATH" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# --no-install: use the repo's pinned prettier, never download one.
# --ignore-unknown: skip file types prettier can't format.
npx --no-install prettier --write --ignore-unknown "$FILE_PATH" \
  >/dev/null 2>&1 || true
exit 0
