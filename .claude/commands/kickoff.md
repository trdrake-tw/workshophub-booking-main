---
description: Kick off a Trello card — move it to In Progress, save it to ./stories, and create the wh-{id}-{desc} branch
argument-hint: <story key e.g. WH-2, or Trello card URL>
allowed-tools: AskUserQuestion, Bash, Write, mcp__trello__trelloReadCard, mcp__trello__trelloReadList, mcp__trello__trelloSearch, mcp__trello__trelloWriteCard
---

# Kickoff: $ARGUMENTS

Start work on the Trello card `$ARGUMENTS`. Follow these steps in order. Stop when you reach the end.

## 1. Find the card

The WorkshopHub board is `https://trello.com/b/hIFGA2tO/workshop-hub-trdrake-tw`, ARI `ari:cloud:trello::board/workspace/6af0ec4fa44a2dd472875cab/6af0fbea8db58f2c0f54540b`. Card names start with the story key, e.g. `WH-2: Employee can register for an available training session`.

- **A card URL** (`https://trello.com/c/<shortLink>/<slug>`): use it as is.
- **A story key** (`WH-2`, `wh-2`, or just `2`): find the card with `mcp__trello__trelloSearch` (`search_cards`, `boardIds` set to the board ARI, query `WH-2`). Keep only the card whose name starts with exactly `WH-2:`. `WH-2` must not match `WH-20`.
- **Anything else** (a name or keywords): search the same way. If the search finds several cards or none, use AskUserQuestion to ask which card is meant.
- **Empty:** use AskUserQuestion to ask for the card URL.

## 2. Read the card

Call `mcp__trello__trelloReadCard` with `action: "get"`. Note:

- The card ARI (`id`). Every write needs it; URLs aren't accepted for writes.
- The name, description, checklists, labels, members and comments. The acceptance criteria are usually in the description under `## Acceptance Criteria`. If the description says it was truncated, take the rest from the card's `Full Description` checklist item.
- The **story key**, from the start of the card name: `WH-2: …` → key `WH-2`, number `2`. Don't use the number in the card URL: that's Trello's own card number and it doesn't match the key. If the name has no `WH-n` prefix, use AskUserQuestion to ask for the key.
- The card's current list and its board.

If the card isn't found, report that and stop. If the acceptance criteria are missing or ambiguous, use AskUserQuestion to clarify before going on. Don't guess.

## 3. Choose the branch name

- Build the name `wh-{number}-{desc}`, where `{desc}` is 2–5 words of the card name in kebab-case, lower case, with only `[a-z0-9-]`. Example: `wh-2-employee-session-registration`.
- The name must match `^wh-[a-zA-Z0-9_-]+-[a-zA-Z0-9_-]+$`. That's the pattern the Husky pre-commit hook checks (`scripts/branch-name-check.sh`).
- If `git branch --list <name>` shows the branch already exists, use AskUserQuestion to ask whether to reuse it or choose a different name.

## 4. Move the card to In Progress

Trello has no transitions. Moving a card to a different list is how its status changes.

1. List the WorkshopHub board's lists with `mcp__trello__trelloReadList` (`action: "list_by_board"`, `boardId` set to the board ARI from step 1). Find the one named `In Progress`. The board currently calls it `IN PROGRESS`, so ignore case and surrounding whitespace when matching.
   - If the card isn't on this board, report that and stop.
   - If there's no `In Progress` list, report the list names and use AskUserQuestion to ask which list to use. Don't create one.
2. If the card is **not** in that list, move it there with `mcp__trello__trelloWriteCard` (`action: "move"`, `cardId`, `listId` set to the In Progress list ARI, `pos: "top"`).
3. If the card is **already** in that list, don't move it. Use `mcp__trello__trelloWriteCard` (`action: "add_comment"`) to post a short comment recording this kickoff attempt, for example: `Kickoff re-run via Claude Code on branch <branch> (<YYYY-MM-DD from `date +%F`>).`

## 5. Write clarifications back to the card (only if there are any)

If step 2 produced clarifications, ask with AskUserQuestion whether to post them on the card. If the user says yes, use `mcp__trello__trelloWriteCard` (`action: "add_comment"`). Don't overwrite the card description.

## 6. Save the story

Use Write to create `./stories/<branch>.md`, named after the branch from step 3, which matches the existing files (e.g. `stories/wh-2-employee-can-register-for-an-available-training-session.md`). If the file already exists, use AskUserQuestion to ask whether to overwrite it.

```markdown
# WH-{number}: {card name}

- **List:** {list after step 4}
- **Labels:** {labels or None}
- **Members:** {members or Unassigned}
- **Card:** {card URL}

## Description
{card description}

## Acceptance Criteria
{checklist items as `- [ ]` / `- [x]`, or "None specified"}

## Clarifications
{answers gathered via AskUserQuestion, or "None"}
```

## 7. Create the branch

- Run `git status --porcelain`. If there are uncommitted changes, use AskUserQuestion to ask whether to carry them onto the new branch or stop.
- Run `git checkout -b <branch>`. If the user chose to reuse an existing branch in step 3, run `git checkout <branch>` instead.

## 8. Confirm and stop

Report:

- `WH-{number}` and the card name, with the card URL
- The Trello action taken (moved from `<old list>` to `In Progress`, or commented), plus any clarification comment
- The story file path
- The branch name, confirmed with `git branch --show-current`

Then stop. Don't start implementing, commit or push.
