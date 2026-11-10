---
name: commit
description: Use when the user asks to commit, make a commit, or save work to git in WorkshopHub. Covers card-key-prefixed (WH-n) conventional commit messages and the branch rules enforced by the Husky pre-commit hook.
---

# Commit (WorkshopHub)

Create one local commit with a conventional commit message prefixed by the story key from the Trello card name (e.g. `WH-2`). Never push.

## Hard rules

- **Never commit on `main`.** If `git branch --show-current` prints `main`, stop and tell the user to create a feature branch (`wh-<ticket>-<desc>`, e.g. `wh-2-registration`). Do not create one or switch to it for them unless they ask.
- **Never use `--no-verify`** (or `-n`, or `HUSKY=0`). If a hook fails, show the output, fix the cause or ask the user, then commit again.
- **Never commit secrets.** Do not stage `.env`, `.env.*`, `*.pem`, `*.key`, credential/token files, or `*.sqlite*` databases. Check the staged diff for API keys, tokens, passwords and private keys. If you find any, stop and tell the user.
- **Never push.** No `git push`, no `--force`, no amending published commits. Stop once the commit exists.

## Steps

1. **Check the branch.** Run `git branch --show-current`. If it's `main`, refuse (see above).
2. **Find the card key.** Branches follow `wh-<string>-<string>` (enforced by `scripts/branch-name-check.sh`). If the branch starts with `wh-<digits>`, the key is `WH-<number>` (the story key from the Trello card name): `wh-2-registration` → `WH-2`. If there is no number (e.g. `wh-feature-auth`), **ask the user for the story key (e.g. `WH-2`)**. Do not guess it or leave it out.
3. **Show the state.** Run `git status` and `git diff --stat` (plus `git diff --cached --stat` if something is already staged). Give a 2–4 line summary of what changed.
4. **Decide what to stage.** If something is already staged, commit that. If nothing is staged, propose a list of files that belong to this change. Leave out unrelated edits, build output and local config such as `opencode.json`, unless the user says otherwise. Stage files by name with `git add <path>...`, never `git add -A` or `git add .`.
5. **Scan for secrets.** Run `git diff --cached` and check it against the secrets rule.
6. **Propose a message:**
   ```
   WH-2 feat(api): add registration endpoint for training sessions

   Optional body: explain why, wrapped at 72 chars.
   ```
   - Format: `<CARD-KEY> <type>(<optional scope>): <imperative summary>`. Keep the subject line under 72 characters.
   - Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`, `perf`, `style`.
   - Scopes: `api`, `app`, `prisma`, `ci`, or leave it out.
7. **Confirm.** Show the files to be committed and the message. Ask the user to approve or edit it, and wait for their reply. Don't commit before they approve.
8. **Commit.** Run `git commit -m "<subject>" -m "<body>"` (or use a heredoc). The Husky pre-commit hook runs branch-name and REASONS lint checks. If it fails, report the output and fix the problem. Do not bypass the hook.
9. **Report and stop.** Show `git log --oneline -1` and `git status`. Don't push, and don't offer to push unless the user asks.

## Common mistakes

| Mistake | Fix |
|---|---|
| Inventing a card key when the branch has none | Ask the user |
| `git add -A` sweeps in `.env` or `opencode.json` | Stage explicit paths |
| Hook fails → retry with `--no-verify` | Fix the cause or ask the user |
| Committing right after proposing the message | Wait for explicit approval |
| Pushing "to finish up" | Stop after the commit |
