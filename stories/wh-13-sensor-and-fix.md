# WH-13: Harness: sensors run automatically and failures are fixed in a bounded loop (sensor-and-fix)

- **List:** IN PROGRESS
- **Labels:** None
- **Members:** Unassigned
- **Card:** https://trello.com/c/RalPlWiY

## Description

### Context

Module 10's slide lists `.claude/commands/sensor-and-fix.md` ("runs test/lint/format, auto-fixes failures"), but it isn't on `main` (see the Module 10 feedback card). This card sets out the requirements before anything is built.

**What exists today:**

- `.claude/hooks/prettier_on_write.sh`, a PostToolUse hook on `Write|Edit` that formats the edited file. It never blocks and never reports anything.
- `make test` (Jest, API only), `make lint` (ESLint, app + api), `make format-check` (Prettier, check only) and `make build` (`tsc`, the only type check).
- There's no ESLint autofix on edit, no typecheck target, and nothing that runs the sensors and acts on the results.

### Design: split the sensors by cost and by who can fix them

| Sensor                     | Cost                           | Fixed by                               | Where it runs                                                |
| -------------------------- | ------------------------------ | -------------------------------------- | ------------------------------------------------------------ |
| Format (Prettier)          | ms, one file                   | A tool, deterministically              | **Per edit** (already does)                                  |
| Lint (ESLint `--fix`)      | ms, one file                   | Mostly a tool; the rest need the model | **Per edit**, with leftover errors **reported to the model** |
| Typecheck (`tsc --noEmit`) | seconds, whole project         | The model                              | **sensor-and-fix**                                           |
| Tests (`make test`)        | ~10 s+, whole suite, shared DB | The model, with judgement              | **sensor-and-fix**                                           |

Format and lint shouldn't be part of a fix loop: they almost always pass, and when they don't the fix is mechanical. Fixing them at the moment a file is written means the loop is left with only what needs thinking: types and tests.

### Story

As a developer working with Claude Code, I want formatting and lint problems corrected as files are written, and a single command that runs the remaining sensors and tries a **limited** number of fixes, so that the agent hands me green code, or a clear report of what it couldn't fix, without looping forever or cheating to get green.

### Out of Scope

- A fully autonomous analyse → canvas → generate → test → PR loop. SPDD has human checkpoints (card clarifications, canvas review, UI check) that shouldn't be automated away.
- A Stop-hook "goal" gate that forces every turn to end green (see Notes; possible follow-up).
- A Workflow / multi-agent version (see Notes).
- Typecheck in the per-edit hook or the commit/push hooks (decided: it lives in sensor-and-fix only, for now).
- CI changes (reasons-lint in `pr-check.yml` is a separate item on the Module 10 feedback card).
- Frontend tests: the app has no test runner.

### Suggested Tests

- **Hook:** pipe-test with a synthetic PostToolUse payload against (a) a file with a Prettier problem → fixed; (b) a fixable ESLint problem (e.g. `prefer-const`) → fixed; (c) an unfixable one (`no-explicit-any`) → reported in `additionalContext`, exit 0; (d) a `.md` file → no-op.
- **Command, green path:** on a clean tree it reports all sensors passing with 0 rounds used.
- **Command, fixable:** introduce a deliberate type error in a service → fixed in 1 round.
- **Command, budget:** introduce a failure it can't fix without editing a test (change an error-message string the tests pin) → stops and asks rather than editing the test; reports what's left.
- **Command, RED:** with a new failing `wh-N` test and no implementation → reported as expected RED, not changed.

### Notes: why a command, not a goal hook or a Workflow

- **Slash command (chosen):** the fixing needs the context of the current change (what the developer and the agent were doing), which the main conversation already has. Fixes are sequential (each round depends on the last), and the human sees the report and stays in the loop.
- **Stop hook as a "goal" (follow-up candidate):** a Stop hook that runs `make typecheck && make test` and blocks the stop until they're green is the native way to get "keep going until green". `stop_hook_active` stops it chaining forever. But it would fire at the end of _every_ turn, including Q&A and Trello work. It costs a full test run each time, and it removes the human checkpoint. It's worth trying only when scoped (e.g. only on a `wh-*` branch with code changes since the last green run), and after the command has proved its guardrails.
- **Workflow:** Workflows fan out to parallel subagents. That helps when failures are many and **independent** (e.g. 10 suites broken by unrelated causes). In this repo failures are usually few and share one cause, the subagents wouldn't have the conversation's context, and it costs much more. Not worth it here.
- **The round limit is a prompt instruction, so it's soft.** If it proves unreliable, move the counting into a script (`scripts/sensors.sh` prints a machine-readable summary; the command keeps a round counter) so the limit doesn't depend on the model's self-discipline.

## Acceptance Criteria

**Part A: per-edit hook (extends `prettier_on_write.sh`, or a sibling hook)**

- [x] 1. After Write/Edit on a `.ts`/`.tsx` file in `api/` or `app/`, the hook runs Prettier `--write`, then ESLint `--fix` on **that file only**, using the repo's pinned binaries (`--no-install`).
- [x] 2. If ESLint errors remain after `--fix`, the hook passes them to the model as information through PostToolUse `hookSpecificOutput.additionalContext`: one line per error, with file:line, rule and message. It exits 0 and does **not** block the edit.
- [x] 3. Files outside `api/`/`app/`, and file types the tools don't handle, are skipped silently. A hook failure never breaks the session (`|| true` around tool errors).
- [x] 4. The hook runs in under 3 s on a typical file.

**Part B: `/sensor-and-fix` command (`.claude/commands/sensor-and-fix.md`)**

- [ ] 5. It runs the sensors in this order and stops at the first that fails each round: **format-check → lint → typecheck → test**. Format and lint should already be clean because of Part A; they're here as a backstop.
- [x] 6. Typecheck is a new `make typecheck` target (`tsc --noEmit` for api and app), so the command doesn't need a full `make build`. `make typecheck` runs **only** inside sensor-and-fix. It isn't added to the per-edit hook, `make lint` or the commit/push hooks.
- [ ] 7. **Fix budget: at most 3 fix rounds.** One round = read the failures, make one coherent fix, re-run the sensors.
- [ ] 8. **Stop early if a round makes no progress**, i.e. the same failing tests or errors as the previous round.
- [ ] 9. When it ends, it prints a report: the sensors' status (pass/fail per sensor), the rounds used, what changed in each round (files, plus a one-line reason), and anything left failing, with its best diagnosis.
- [ ] 10. It **never** commits, pushes or changes git state beyond editing files.

**Guardrails: what counts as cheating (CLAUDE.md norm 3)**

- [ ] 11. It must not edit test files, `eslint`/`prettier`/`tsconfig`/`jest` config, or `package.json` scripts to make a sensor pass. If it decides a test is wrong, **it stops and asks** (HITL), with its reasoning.
- [ ] 12. It must not add `eslint-disable`, `@ts-ignore`/`@ts-expect-error`, `any`/`as any`, `.skip`/`.only`/`xit`, or remove assertions.
- [ ] 13. If the failing tests are deliberately RED (TDD tests written before the implementation, e.g. by `test-writer`), it reports them as **expected RED** and doesn't "fix" them.
- [ ] 14. Failures it can't attribute to the current change (they also fail on `main`) are reported as **pre-existing** and not fixed.

## Clarifications

Decided with the user on 2026-11-12, and already recorded on the card under "Decisions":

1. **Fix budget: 3 rounds** (AC 7).
2. **Leftover lint errors are passed to the agent as information** (`additionalContext`, exit 0), not as a blocking error (AC 2).
3. **Typecheck runs only in sensor-and-fix**, not on every edit or in the commit/push hooks, because sensor-and-fix is the last step of the dev flow. Revisit if type errors start reaching review (AC 6).
4. **`make typecheck` was red on `main`** because `app/src/vite-env.d.ts` was missing, so `import.meta.env` didn't type-check. `app`'s `build` script hid it: a bare `tsc` against a references-only `tsconfig.json` checks 0 files. Decided 2026-11-13: add the standard one-line file in WH-13 so the sensor starts green.
5. **Hook reports ESLint warnings as well as errors** (a small step beyond AC 2's "errors"). `api/.eslintrc.cjs` sets `no-explicit-any` to `warn`, so reporting errors only would never surface CLAUDE.md norm 1 in `api/`. `make lint` has 0 warnings today, so this adds no noise.

ACs 5 and 7–14 are written into `.claude/commands/sensor-and-fix.md` but haven't been tried on a real failure yet (see the card's Suggested Tests).
