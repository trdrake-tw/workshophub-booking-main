---
name: tdd
description: Use when the user asks to TDD, red-green, or test-drive one acceptance criterion or one Operation in WorkshopHub. Runs a single red-green loop by delegating to the project's test-writer and implementer agents, with a navigator checkpoint at RED. One slice per invocation, then stop.
---

# TDD (WorkshopHub)

Run **one** red-green loop for **one** slice (one acceptance criterion or one Operation). You orchestrate: the `test-writer` agent writes the failing tests, the `implementer` agent makes them pass, and you run `make test` between them. You don't write tests or implementation yourself.

## Hard rules

- **ONE slice per run, then stop.** Never start the next criterion, Operation or story, even if the navigator's paste contains several or the loop finished quickly.
- **Delegate.** Tests come from `test-writer`, implementation from `implementer`. Don't write or edit files under `api/tests/` or `api/src/` yourself, and don't "just fix" what an agent got wrong: send it back to that agent.
- **RED needs the navigator's confirmation.** Don't delegate to `implementer` until the navigator has confirmed the tests fail for the right reason.
- **You run `make test`.** Don't take an agent's word for red or green.
- **Never weaken a test to get green.** No skipping or deleting tests, no `--no-verify`, no config changes.

## Steps

1. **Ask for the slice.** Ask the navigator which ONE slice this run implements. Accept whatever they provide: a pasted acceptance criterion from a story, an Operation, or a REASONS canvas excerpt. If the invocation already names exactly one slice, restate it in one line and carry on. If it names several, or only a story key, ask which one. Don't choose for them.

2. **Build the packet.** Assemble a navigator packet for the agents from what the navigator gave you. It MAY include:
   - the acceptance criterion and/or Operation text
   - Requirements
   - Entities
   - Approach
   - Structure
   - Norms
   - Safeguards
   - out-of-scope do-nots
   - intended module paths

   Pass through what the navigator provides, verbatim where you can. Don't strip Approach or Operations, don't require sections that are missing and don't fill gaps with your own design. If the paste covers more than the chosen slice, mark the one criterion / Operation as the **current slice** and list the others under do-nots as out of scope. Don't invent a whole-story suite.

3. **RED: delegate to `test-writer`.** Send it the packet. It must not read `api/src/`; don't paste implementation code into the packet to get around that. When it reports back, note the test files and its Assumptions.

4. **Run `make test` and pause.** Run it yourself and show the navigator:
   - the failing tests and their failure output (the assertion or error, not just the count)
   - whether anything outside the new tests failed
   - the test-writer's Assumptions, if any

   Then **stop and ask the navigator to confirm RED for the right reason**: the tests fail because the behaviour is missing, not because of a typo, a bad import or a type error. Wait for their reply. Don't implement yet.

   - If the new tests pass already, or fail for the wrong reason, say so and send the problem back to `test-writer` (or ask the navigator), then rerun this step.
   - If the navigator wants the tests changed, send that to `test-writer` and rerun this step.

5. **GREEN: delegate to `implementer`.** Only after the navigator confirms RED. Send it the same packet plus the failing-tests context: the test file paths, the failing `it` names and the failure output from step 4.

6. **Run `make test` again.** Run it yourself and confirm every test passes, the new ones and the existing ones. Show the totals. If it isn't green, send the output back to `implementer` once; if it's still not green after that, stop and report to the navigator instead of looping.

7. **STOP.** Report and end the run:
   - **Slice:** the criterion / Operation, quoted
   - **Tests:** files written by `test-writer`
   - **Implementation:** files changed by `implementer`
   - **Result:** `make test` totals
   - **Open items:** assumptions, deviations or follow-ups the agents reported, or "None"

   Don't start the next slice, and don't commit or push. The navigator runs this skill again for the next one.

## Common mistakes

| Mistake                                           | Fix                                                     |
| ------------------------------------------------- | ------------------------------------------------------- |
| Paste has four criteria, so you test all four     | Ask which ONE; list the rest as out of scope            |
| Trimming Approach or Operations out of the packet | Pass through what the navigator provided                |
| Going straight from test-writer to implementer    | Run `make test`, show the failure, wait for RED confirm |
| Trusting the agent's "tests fail" / "all green"   | Run `make test` yourself                                |
| Fixing a failing test or a bug yourself           | Send it back to the agent that owns it                  |
| Green came quickly, so you start the next slice   | Stop. One slice per run                                 |
