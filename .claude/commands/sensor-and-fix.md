---
description: Run the sensors (format-check, lint, typecheck, test) and make at most 3 rounds of fixes, without editing tests or config
argument-hint: '[optional note on what the current change is]'
allowed-tools: AskUserQuestion, Bash, Read, Edit, Write, Grep, Glob
---

# Sensor and fix

Run the project's sensors and fix what they find, within a fixed budget. This is the last step of the dev flow, after the implementation and before `/commit`. Format and lint are normally clean already, because the PostToolUse hook (`.claude/hooks/prettier_on_write.sh`) formats and lint-fixes each file as it's written. They're checked here as a backstop.

Current change (optional, from the user): $ARGUMENTS

## 1. Establish the baseline

1. Run `git status --porcelain` and `git diff --stat main...HEAD` (plus the working-tree diff) to see which files this change touches. Fixes go in those files unless a failure clearly points somewhere else.
2. Note any test files that are new on this branch and have **no implementation yet** (e.g. `wh-N-*.test.ts` written by the `test-writer` agent for the RED step). Failures in those are **expected RED**.

## 2. Run the sensors

Run them in this order. Stop at the first one that fails, and fix that before running the later ones.

```bash
make format-check
make lint
make typecheck
make test
```

If all four pass, go to step 5 and report green with 0 rounds used.

## 3. Fix loop: at most 3 rounds

One **round** is: read the failure output, find the cause, make **one coherent fix** (it may touch several files if they share a cause), then run the sensors again from the top (step 2).

- **Budget: 3 rounds, no more.** Count them out loud ("Round 1 of 3"). After round 3, stop and report, even if you think one more would do it.
- **Stop early if there's no progress.** If a round ends with the same failing tests or errors as the round before, stop and report. Don't spend the remaining rounds on it.
- **Format failures:** run `pnpm --filter @workshophub/<pkg> exec prettier --write <files>` on the files `format-check` lists.
- **Lint failures:** run `eslint --fix` on the files first, then fix by hand whatever's left.
- **Type and test failures:** read the failing code and fix the **implementation**. A test failure means the code doesn't do what the test says. Assume the test is right.

## 4. Guardrails: never do these to get green

These rules come from CLAUDE.md norm 3 ("do not disable rules or skip tests to get green"). Breaking one is a failed run, even if the sensors go green.

- Don't edit test files (`api/tests/**`, `*.test.ts`) or config: `.eslintrc.cjs`, `.prettierrc`, `tsconfig*.json`, `jest.config.js`, or the `scripts` in any `package.json`, Makefile or Husky hook.
- Don't add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `any` or `as any`, `.skip`, `.only`, `xit`/`xdescribe`, and don't remove or weaken assertions.
- **If you believe a test is wrong** (it contradicts the story's acceptance criteria, or pins behaviour that has changed on purpose), stop and use AskUserQuestion. Name the test, quote the assertion, and give your reasoning. Don't change it yourself.
- **Expected RED:** failures in the RED tests from step 1 are reported as expected RED and not fixed. Implementing a story isn't this command's job.
- **Pre-existing failures:** if a failure might not come from this change, check whether it also fails on `main`, e.g. with `git stash` / `git worktree` or by checking whether any of the failing files are in the diff. If it does, report it as **pre-existing** and don't fix it.
- Never commit, push, stash-and-forget, reset, or change branches. Only edit files. Leave the working tree in a state the user can review with `git diff`.

## 5. Report

End with this report, and nothing after it:

```
## Sensor-and-fix report

| Sensor       | Result |
|--------------|--------|
| format-check | pass / fail / not run |
| lint         | ... |
| typecheck    | ... |
| test         | pass / fail (N failing) / not run |

Rounds used: N of 3 (stopped because: all green / budget spent / no progress / asked user)

### Changes
- Round 1: <files> — <one-line reason>
- ...

### Still failing
- <test or error> — <best diagnosis> — <expected RED / pre-existing / not fixed: reason>
```

If nothing is still failing, write "None" under **Still failing**.
