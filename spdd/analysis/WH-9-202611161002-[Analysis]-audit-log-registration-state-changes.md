# SPDD Analysis: Audit log for registration state changes

## Original Business Requirement

# WH-9: Audit log for registration state changes

- **List:** IN PROGRESS
- **Labels:** blue (unnamed)
- **Members:** Unassigned
- **Card:** https://trello.com/c/5dn0NMBd/9-wh-9-audit-log-for-registration-state-changes

## Description

### Context

For compliance and debugging, every state change to a registration should be recorded. An audit log captures who did what and when, and provides a full history for each registration lifecycle.

This is a **trainee exercise story**. It is not implemented in the baseline template.

### Description

As a training organiser, I want an audit log of every state change to a registration so that I can trace the full history of a registration for reporting or dispute resolution.

Each state change (registered, waitlisted, promoted, cancelled) creates an immutable audit log entry. The organiser queries the audit log via the API.

### Out of Scope

_Not available. The card description is cut off at this heading ("truncated — see 'Full Description' checklist item below"), and the card has no checklists, attachments or comments to take the rest from. See Clarifications._

## Acceptance Criteria

**Organiser workflow:**

- [ ] The organiser opens the session registrations page (WH-6) and identifies the registration ID they want to investigate
- [ ] The organiser calls `GET /api/training-sessions/:id/registrations/:registrationId/audit` to see the full state history
- [ ] The response shows a time-ordered list of transitions, e.g.:
  - `null → confirmed` (registered)
  - `confirmed → cancelled` (cancelled)
  - _(for a different registration)_ `null → waitlisted` then `waitlisted → confirmed` (promoted)
- [ ] This gives the organiser a complete picture of every state a registration has been through

**Data and API behaviour:**

- [ ] An `AuditLog` table is created with: `id`, `registrationId`, `fromStatus`, `toStatus`, `changedAt`, `reason` (optional string)
- [ ] Every registration state change creates an audit log entry atomically within the same transaction
- [ ] `GET /api/training-sessions/:id/registrations/:registrationId/audit` returns the full audit history in chronological order
- [ ] Audit entries are immutable: they cannot be updated or deleted via the API
- [ ] Returns HTTP 404 if the registration does not exist
- [ ] The audit log captures all transitions: initial registration, promotion, cancellation

## Clarifications

None gathered. Kickoff ran unattended (deliver-story workflow, 2026-11-16) with no navigator to ask. Open questions, not answered:

1. **Out of Scope / Suggested Tests / hints:** the card's description is truncated after the acceptance criteria and the `Full Description` checklist item it points to does not exist on the card. Everything after `## Out of Scope` is unknown.
2. **WH-6 dependency:** the first acceptance criterion refers to the session registrations page (WH-6), which is still in To Do and not implemented. It is unconfirmed whether WH-9 is API-only, with that criterion treated as context rather than something to build.

## Domain Concept Identification

### Existing Concepts (from codebase)

- **TrainingSession**: a bookable training session with a capacity and a confirmed-seat counter. Owns its registrations; deleting a session deletes its registrations. It scopes the audit endpoint: a registration is only reachable through the session it belongs to.
- **Registration**: an employee's place on a session, with a status of `confirmed`, `waitlisted` or `cancelled`. It holds only its current status and its creation time, so today there is no record of how it got there. It is the subject of every audit entry.
- **Registration status vocabulary**: the three status values are defined once in the training-session service and stored as plain text. The audit entry's "from" and "to" values use this same vocabulary, plus "nothing" for the state before a registration exists.
- **Initial registration (WH-2/WH-3)**: creating a registration ends as confirmed (a seat was claimed) or waitlisted (the session was full). The decision and the new registration are written in one transaction. This is the first state change: nothing → confirmed, or nothing → waitlisted.
- **Cancellation (WH-4)**: a confirmed or waitlisted registration becomes cancelled. It is a status change, not a deletion, and it is guarded so that only one of two concurrent cancellations succeeds. State changes: confirmed → cancelled, or waitlisted → cancelled.
- **Waitlist promotion (WH-5)**: when a confirmed registration is cancelled, the earliest waitlisted registration of the same session becomes confirmed inside the same transaction, with a retry when the chosen candidate changed concurrently. State change: waitlisted → confirmed, on a different registration from the one cancelled.
- **Registration status lookup (WH-5)**: an existing read endpoint returns one registration's current status, scoped by session, answering "not found" for an unknown, mismatched or malformed identifier. The audit endpoint is its historical counterpart and sits directly beneath it in the URL space.
- **Notification (WH-8)**: a side effect sent after the transaction commits, which may fail without affecting the outcome. It is the deliberate opposite of the audit entry, and the two must not be confused or merged.

### New Concepts Required

- **Audit log entry**: a permanent record that one registration moved from one status to another at a point in time, with an optional reason. Belongs to exactly one registration. Written once, by the system, as part of the state change it describes; never changed afterwards.
- **Transition**: the from/to pair an entry records. The complete set the current system can produce is: nothing → confirmed, nothing → waitlisted, waitlisted → confirmed, confirmed → cancelled, waitlisted → cancelled.
- **Reason**: an optional short text saying why the transition happened. The card's examples label transitions as registered, promoted and cancelled, and its description also names waitlisted. Nothing in the system collects a reason from a person today.
- **Audit history**: all entries of one registration, oldest first. This is what the organiser reads through the new endpoint.
- **Training organiser (as API consumer)**: the person the history is for. The system has no notion of an organiser, of roles or of sign-in; the organiser is simply whoever calls the endpoint.

### Key Business Rules

- **Every state change produces exactly one entry** (explicit): governs Registration, Transition and Audit log entry. A cancellation that also promotes someone produces two entries, one per registration affected.
- **The state change and its entry succeed or fail together** (explicit): governs all three state-changing operations. If the entry cannot be written, the registration, cancellation or promotion must not happen. This inverts the WH-8 rule, where the side effect may fail silently.
- **No entry without a real change** (implicit): a rejected request (invalid input, unknown session, already cancelled, the losing side of a concurrent cancellation, a promotion candidate skipped after a concurrent change) leaves no entry.
- **An entry describes what actually happened** (implicit): the "from" value is the status the registration really had when it changed, not the one first read, and the promoted entry names the registration actually promoted.
- **The first entry starts from nothing** (explicit, from the examples): an initial registration is recorded as a transition from no status.
- **History is chronological and complete** (explicit): governs Audit history. Each entry's "from" should equal the previous entry's "to"; a gap would mean a change bypassed the audit.
- **Entries are immutable through the API** (explicit): the API offers reading only. Nothing in the API can alter or remove an entry.
- **History is reached through the owning session** (implicit, from the URL shape and the existing lookup): a registration requested under a session it does not belong to is "not found".
- **An existing registration with no entries is not an error** (implicit): registrations created before this story, or by the seed script, have no history; the registration exists, so the answer is an empty history, not "not found".
- **The seat counter is not a registration state** (implicit): changes to a session's confirmed-seat count are consequences of state changes and are not audited separately.

## Strategic Approach

### Solution Direction

- Treat this as an API-and-data story with no frontend work: one new persistent concept, one cross-cutting write rule applied to the three existing state-changing paths, and one new read endpoint.
- Write side: the service layer already performs each state change inside a database transaction. Recording the entry becomes part of that same unit of work, immediately after the change is known to have taken effect. Flow: route (unchanged) → service performs the state change inside its transaction → the same transaction records the transition → commit → existing post-commit notification (unchanged).
- Read side: route (thin: identifier validation and HTTP mapping) → service-layer lookup that first confirms the registration exists under that session, then returns its entries oldest first → route maps "no such registration" to 404.
- Follow the conventions already in place: no data access in routes; no `any`; the same identifier validation and "not found" behaviour as the existing registration lookup; integration tests through the HTTP API with `test-`-prefixed emails and their own cleanup; unit tests with the data layer mocked.
- The schema is applied by pushing the schema definition (there are no migration files), locally, in CI and at container start, so the new table arrives the same way.
- Deliver through the project's one-slice TDD loop, one acceptance criterion per slice: initial registration (confirmed and waitlisted), cancellation, promotion, the read endpoint with ordering, the 404, and immutability.

### Key Design Decisions

- **Where audit recording lives — inside the existing training-session service vs a small dedicated audit capability in the service layer**: inlining is the least change but spreads audit knowledge across three code paths and makes a future fourth path easy to forget. A dedicated capability gives one place that knows how an entry is written and read. → **Recommend a small dedicated audit capability in the service layer that takes part in the caller's transaction**, with the state-changing operations calling it.
- **How a change is captured — explicit recording at each state change vs automatic interception of every registration write (ORM extension or database trigger)**: interception can't be forgotten, but the existing changes are guarded bulk updates that only report how many rows matched, so an interceptor cannot reliably know the previous status or whether anything changed; a trigger would live outside the schema-push workflow. → **Recommend explicit recording at the three known points**, with the "history has no gaps" rule covered by tests.
- **What happens to entries when a registration is removed — remove them with it, block the removal, or keep them without a link**: the API never deletes a registration (cancellation is a status change), but the seed script, database reset, session deletion and every existing integration suite's cleanup do delete registrations directly. Blocking removal would break all of those; keeping orphans gives entries nobody can reach through the endpoint. → **Recommend entries are owned by their registration and removed with it.** Immutability is promised "via the API" and still holds. This is a compliance-relevant choice and is listed as an ambiguity.
- **What the reason holds — system-supplied label vs left empty**: the card's examples annotate each transition (registered, promoted, cancelled), and the reason is the only way to tell a promotion (waitlisted → confirmed) apart at a glance. Leaving it empty satisfies "optional" but wastes the field. → **Recommend the system fills it with a fixed label per kind of change: registered, waitlisted, promoted, cancelled**, matching the four kinds named in the description. No reason is accepted from callers.
- **Ordering of the history — time only vs time with a stable tie-break**: two entries for one registration can share a timestamp at millisecond resolution (for example a registration cancelled immediately). → **Recommend ordering by time, with creation order as the tie-break**, the same approach the waitlist already uses.
- **Identifier and not-found behaviour — follow the existing registration lookup vs introduce 400 for malformed identifiers**: the neighbouring endpoints answer 404 for unknown, mismatched and malformed identifiers alike, and that is pinned by tests. → **Recommend the same behaviour**, including 404 for an unknown session.
- **Existing registrations — backfill a starting entry vs leave them without history**: a backfill would have to invent timestamps and transitions for cancelled or promoted rows it cannot reconstruct, which is worse than no history in an audit log. → **Recommend no backfill; such registrations return an empty history.** Whether the seed script should write entries for its two fixture registrations is listed as an ambiguity; the recommendation is to leave the seed unchanged.
- **Proving immutability — test that no modifying operation exists vs add explicit refusals**: the API has no route that could alter an entry, so modifying requests on the audit address are already rejected as unknown. Adding explicit "not allowed" responses is extra surface. → **Recommend exposing reading only and pinning with tests that modifying requests are rejected and leave the history unchanged.**
- **Access control — add organiser-only protection vs leave open**: the system has no authentication at all and the existing admin endpoint is open with a note to fix it. Adding sign-in is a separate feature. → **Recommend leaving the endpoint open, consistent with the rest of the API, and stating it as a known limitation.** The history itself carries no name or email.

### Alternatives Considered

- **Recording the entry after commit, like the WH-8 notification**: simpler to bolt on, but an entry could be lost after a successful change, which the card explicitly rules out ("atomically within the same transaction"). Rejected.
- **Deriving history from the registration's current status and creation time**: no new table, but it cannot recover intermediate states or times, and the card requires a table. Rejected.
- **Database triggers on the registrations table**: guarantees capture even for direct writes, but lives outside the schema definition that is pushed everywhere, is invisible to the service layer and its tests, and would also log seed and test-cleanup activity. Rejected.
- **A generic audit log for any entity**: more reusable, but the card defines a registration-specific shape and nothing else needs auditing. Rejected as speculative.
- **Recording the actor ("who")**: the context sentence mentions "who", but the required fields have no actor and the system cannot identify callers. Not built; raised as an ambiguity.
- **Building the organiser's registrations page as part of this story**: that is WH-6, still to do. Rejected; the first criterion is treated as context.
- **Adding a link or view of the history in the frontend**: not asked for; the organiser "calls" the endpoint. Rejected.

## Risk & Gap Analysis

### Requirement Ambiguities

- **Out of Scope is unknown**: the card text is truncated after the acceptance criteria, so any exclusions, suggested tests or implementation hints are missing. The analysis assumes the acceptance criteria are the full scope.
- **WH-6 dependency**: the first criterion has the organiser find the registration ID on a page that does not exist yet. Assumed to be context, not something to build; WH-9 is delivered API-only and the ID is obtained some other way (for example from the registration response).
- **"Who did what and when"**: the context promises "who", but the table definition has no actor field and the system has no sign-in. Assumed that "who" is out of scope and only what/when (plus reason) is recorded.
- **What the optional reason contains**: free text from a caller, a system label, or always empty? Assumed a system-supplied label (registered, waitlisted, promoted, cancelled) and that callers cannot supply one.
- **Label for a waitlisted registration**: the description names four kinds of change (registered, waitlisted, promoted, cancelled) but the examples only label three, and show `null → waitlisted` without a label. Assumed `null → waitlisted` is labelled "waitlisted" and `null → confirmed` "registered".
- **Fate of entries when a registration row is deleted**: "immutable" and "for compliance" suggest they should outlive everything, but registrations are deleted by the seed, the database reset, session deletion and test cleanup. Assumed entries are removed with their registration, since the promise is limited to "via the API" and the API never deletes a registration.
- **Registrations that pre-date the audit log**: no entry exists for them. Assumed no backfill and an empty history (HTTP 200), not 404.
- **Seed data**: the seed script creates two confirmed fixture registrations directly. Should they get a starting entry? Assumed no; the seed is left unchanged.
- **Response shape**: the criteria name the table's fields but not the response. Is it a bare list or wrapped, and does it repeat the registration ID in every entry? Assumed a bare list of entries exposing the table's fields, with the "from" of the first entry explicitly empty.
- **"Chronological order" on equal timestamps**: not defined. Assumed creation order breaks ties.
- **What "cannot be updated or deleted via the API" must look like**: is the absence of such operations enough, or is an explicit refusal (for example "method not allowed") expected? Assumed absence is enough; modifying requests get the API's normal response for an unknown operation.
- **Malformed or mismatched identifiers**: only "registration does not exist" is specified. Assumed 404 for an unknown session, a registration under the wrong session, and non-numeric identifiers, matching the neighbouring endpoints.
- **Who may call the endpoint**: the story says "organiser" but there are no roles. Assumed open, like the rest of the API.
- **Failure of the audit write**: "atomically" implies a failed entry aborts the state change, so an audit fault would stop employees registering or cancelling. Assumed that is the intended trade-off for a compliance log.
- **"A complete picture of every state"**: the fourth workflow criterion is a statement of value rather than a behaviour. Assumed it is satisfied by the other criteria together and needs no separate deliverable.
- **Table name and timestamps**: existing tables use lower-case plural names and the criterion says "`AuditLog` table". Assumed the concept is named AuditLog and its physical naming follows the existing convention; the change time is set by the system, never by a caller.

### Edge Cases

- **Cancellation that promotes someone**: one request, two registrations changed, two entries, each in its own registration's history. The cancelling registration's history must not show the promotion and vice versa.
- **Promotion candidate lost to a concurrent change**: the retry moves to the next candidate; only the registration really promoted gets an entry, and the skipped one gets none.
- **Two concurrent cancellations of the same registration**: exactly one succeeds, so exactly one cancelled entry exists.
- **Cancelling a waitlisted registration**: recorded as waitlisted → cancelled, with no promotion entry for anyone.
- **Cancelling a confirmed registration with an empty waitlist**: one entry only.
- **Repeated cancel of an already cancelled registration**: rejected, no new entry.
- **Rejected registration requests** (missing name, bad email, unknown session): no registration and no entry.
- **Full lifecycle on one registration**: waitlisted, then promoted, then cancelled gives three entries in order, each starting where the previous ended.
- **Registration and cancellation within the same millisecond**: ordering must still be correct.
- **Registration exists but has no entries** (pre-existing or seeded): empty history, not an error.
- **Registration requested under a different session**: not found, so one session's organiser view cannot read another session's registration by guessing IDs.
- **Very large identifiers, zero, negatives, decimals**: treated as not found, as the existing lookup does.
- **Same employee registers twice**: two registrations, two independent histories.
- **A status outside the known three found in the data**: the existing code already refuses to cancel it; no entry should be written for the refusal.

### Technical Risks

- **Existing unit tests mock the data layer per call**: the service's unit tests supply a hand-built transaction object containing only the operations used today. Adding an audit write inside the transaction will make those tests fail until their mocks know about it. Mitigation direction: expect and plan for updating those tests as part of the relevant slice; this is a legitimate test change, not a workaround.
- **Existing cleanup deletes registrations directly**: around twenty integration suites and the seed script delete registrations in bulk. If audit entries block that deletion, the whole suite and `make seed` break. Mitigation direction: the ownership decision above (entries go with their registration), verified by running the full existing suite.
- **Schema must be pushed before tests pass**: tests run against the shared development database file, and nothing in `make test` applies the schema. A developer or pipeline step that runs tests without first pushing the schema will see every registration fail, because the audit write is now part of the transaction. CI pushes the schema before testing and the container does so at start, so the exposure is local. Mitigation direction: note the required setup step in the canvas and the pull request.
- **Longer transactions on a single-writer database**: each state change gains one more write inside its transaction. SQLite allows one writer at a time, and the promotion path already retries under contention. The added work is small, but lock timeouts under the existing concurrency tests are the thing to watch.
- **Atomicity is hard to prove from outside**: showing that a failed audit write rolls back the state change needs a forced failure inside the transaction. Mitigation direction: prove it at the unit level with the data layer mocked, and rely on the integration tests for the success paths.
- **Guarded bulk updates report only a count**: the cancellation and promotion writes do not return the changed row, so the entry must be built from what the operation already knows (the status it matched on and the registration it targeted), and written only when the count shows the change took effect.
- **Blast radius on WH-2 to WH-8 behaviour**: the three state-changing paths carry careful concurrency handling and pinned response shapes. The audit write must not alter their results, status codes or the post-commit notification. The existing suites are the regression gate.
- **Open endpoint on a compliance record**: anyone who can reach the API can read any registration's history by enumerating IDs. Entries carry no personal data, so the exposure is limited to status timelines, but the automated security review may flag it.
- **No new dependency or configuration needed**: everything is achievable with the stack already in place.

### Acceptance Criteria Coverage

| AC# | Description                                                                                                                                        | Addressable? | Gaps/Notes                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Organiser opens the session registrations page (WH-6) and identifies the registration ID                                                           | Partial      | WH-6 is not built. Treated as context; nothing is delivered for it in this story. Needs confirmation.                                                                                                               |
| 2   | Organiser calls `GET /api/training-sessions/:id/registrations/:registrationId/audit` to see the full state history                                 | Yes          | New read endpoint beneath the existing registration lookup. Open to any caller (no roles exist).                                                                                                                    |
| 3   | Response shows a time-ordered list of transitions (`null → confirmed`, `confirmed → cancelled`, `null → waitlisted` then `waitlisted → confirmed`) | Yes          | Response shape and the label for each transition are assumed (see ambiguities).                                                                                                                                     |
| 4   | Gives the organiser a complete picture of every state a registration has been through                                                              | Yes          | A value statement; met by ACs 6, 7 and 10 together. Not true for registrations that pre-date the log (empty history).                                                                                               |
| 5   | `AuditLog` table with `id`, `registrationId`, `fromStatus`, `toStatus`, `changedAt`, `reason` (optional)                                           | Yes          | Arrives by schema push (no migration files). Behaviour when the registration row is deleted is assumed. No actor field, despite "who" in the context.                                                               |
| 6   | Every registration state change creates an entry atomically within the same transaction                                                            | Yes          | All three state-changing paths already run in a transaction. Rollback on audit failure is proven at unit level. Existing unit-test mocks need updating.                                                             |
| 7   | The GET endpoint returns the full audit history in chronological order                                                                             | Yes          | Tie-break for equal timestamps assumed to be creation order.                                                                                                                                                        |
| 8   | Audit entries are immutable: cannot be updated or deleted via the API                                                                              | Yes          | Met by offering reading only; pinned by tests that modifying requests are rejected and change nothing. Explicit refusal status not specified. Direct database deletion of a registration still removes its entries. |
| 9   | Returns HTTP 404 if the registration does not exist                                                                                                | Yes          | Extended by assumption to unknown session, wrong session and malformed identifiers, matching neighbouring endpoints.                                                                                                |
| 10  | Captures all transitions: initial registration, promotion, cancellation                                                                            | Yes          | Five concrete transitions, including waitlisted → cancelled, which the card's examples do not show. A cancellation with promotion writes two entries.                                                               |
