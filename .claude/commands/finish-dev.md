---
description: Finish a story — commit, push, open the pull request against main and move the Trello card to In Review
argument-hint: '[story key e.g. WH-8; defaults to the current branch]'
allowed-tools: AskUserQuestion, Bash, Read, mcp__trello__trelloReadCard, mcp__trello__trelloReadList, mcp__trello__trelloSearch, mcp__trello__trelloWriteCard
---

# Finish dev

Story key (optional, from the user): $ARGUMENTS

Close out the development of one story: commit, push, open the pull request, move the Trello card to `In Review`. Do the steps in order and stop at the first one that fails. A later step never runs on top of a failed one.

Run this after `/sensor-and-fix` has reported green. This command doesn't run the sensors itself: the Husky pre-push hook (`.husky/pre-push`) runs `make test` and `make lint` on the push, and the `pr-check` workflow in CI is the gate after that.

Invoking this command is the approval to commit and push. Don't ask again for those, but report exactly what you did.

## Hard rules

- **The commit follows the `commit` skill** (`.claude/skills/commit/SKILL.md`), including its hard rules: not on `main`, no bypassing hooks, no secrets, files staged by explicit path. Two of its rules don't apply here, because pushing is this command's job and invoking it is the approval: "wait for the user to approve the message" and "never push".
- **Never bypass hooks on the push either.** No `--no-verify` or `HUSKY=0`. If a hook fails, show the output and stop.
- **Never force.** No `git push --force`, no amending or rebasing published commits.
- **Never merge.** This command opens the pull request. It doesn't merge it and doesn't move the card to `Done`.
- **Don't fix code here.** If a hook fails, stop and say so. Fixing is `/sensor-and-fix`.

## Steps

1. **Check the branch and find the story key.** Run `git branch --show-current`. If the branch starts with `wh-<digits>`, the key is `WH-<number>` (`wh-8-notify-registration-promotion` → `WH-8`). If the user passed a key, it must agree with the branch; if it doesn't, stop and report the mismatch. If the branch has no number and no key was passed, ask the user for the key. Don't guess it.

2. **Commit, if there is anything to commit.** Run `git status --porcelain`. If the tree is clean, skip to step 3. Otherwise follow the `commit` skill's steps 3 to 8 (show the state, decide what to stage, scan for secrets, write the message, commit), skipping its step 7 (confirm). List anything you left out of the commit in the report.

3. **Push.** Run `git push -u origin <branch>`. If the push is rejected, show the output and stop. Don't force it.

4. **Open the pull request.** Check for an existing one first with `gh pr view --json url,state`.
   - If an open pull request exists for this branch, don't create another. Use its URL, and update its title and body with `gh pr edit` so they describe the whole branch as it now stands.
   - Otherwise run `gh pr create --base main`. Title: `<KEY> <type>(<scope>): <summary>`, covering the whole branch, not just the last commit. Body:

     ```markdown
     ## Summary

     {what changed and why, 2-5 bullets, with a link to the Trello card}

     ## Acceptance criteria

     {each criterion from the story file as `- [x]` or `- [ ]`, with a note on any that is not done}

     ## Testing

     {the test totals and lint result from the pre-push hook's output, and anything verified manually or not verified}
     ```

   - Take the acceptance criteria from `stories/<branch>.md`. Tick only the ones this branch implements. If some are left open, say so in the Summary too.

5. **Move the card to In Review.** The WorkshopHub board is `https://trello.com/b/hIFGA2tO/workshop-hub-trdrake-tw`, ARI `ari:cloud:trello::board/workspace/6af0ec4fa44a2dd472875cab/6af0fbea8db58f2c0f54540b`.
   1. Find the card with `mcp__trello__trelloSearch` (`search_cards`, `boardIds` set to the board ARI, query the story key). Keep only the card whose name starts with exactly `<KEY>:`. `WH-2` must not match `WH-20`. If there is no such card, report that and skip the rest of this step.
   2. List the board's lists with `mcp__trello__trelloReadList` (`action: "list_by_board"`). Find the one named `In Review`, ignoring case and surrounding whitespace (the board currently calls it `IN REVIEW`). If there isn't one, report the list names and don't create one.
   3. If the card is not in that list, move it with `mcp__trello__trelloWriteCard` (`action: "move"`, `cardId`, `listId`, `pos: "top"`).
   4. Add a comment with `mcp__trello__trelloWriteCard` (`action: "add_comment"`): `Pull request: <URL>`. Skip it if the card already has a comment with that URL.

   Only do this step once the pull request exists. If some acceptance criteria are still open, don't move the card (unless the user asked you to): leave it where it is and say in the comment which criteria are open.

6. **Report and stop.**
   - the story key and card name
   - the commit (`git log --oneline -1`), or "nothing to commit"
   - the branch pushed and the pull request URL (created or already open)
   - the Trello action (moved from `<old list>` to `In Review`, already there, or not done and why)
   - anything left out of the commit, and any acceptance criteria still open

## Common mistakes

| Mistake                                                 | Fix                                   |
| ------------------------------------------------------- | ------------------------------------- |
| A hook fails, so you fix the code and carry on          | Stop. Fixing is `/sensor-and-fix`     |
| A hook fails, so you retry with `--no-verify`           | Show the output and stop              |
| Restating the commit rules here and letting them drift  | The `commit` skill owns them          |
| A pull request is already open, and you create a second | Reuse the open one                    |
| Ticking every acceptance criterion in the PR body       | Tick only what this branch implements |
| Moving the card before the pull request exists          | Card moves last                       |
| Moving the card to `Done`, or merging                   | This command ends at `In Review`      |
