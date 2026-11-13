# SPDD Analysis: Promote the first waitlisted employee after a cancellation

## Original Business Requirement

# WH-5: Promote first waitlisted employee after cancellation

- **List:** IN PROGRESS
- **Labels:** orange (unnamed)
- **Members:** Unassigned
- **Card:** https://trello.com/c/XY7yVQE8

## Description

### Context

When a confirmed registration is cancelled (WH-4), a seat becomes available. The first person on the waitlist should be automatically promoted to confirmed status. This closes the loop between cancellation and waitlist management.

This is a **trainee exercise story**. It is not implemented in the baseline template.

### Description

As a waitlisted employee, I want to be automatically promoted to confirmed when a registered employee cancels so that I can secure the now-available place.

Promotion is automatic — it fires as a side effect of cancellation (WH-4). No user directly triggers it. The first waitlisted employee (by `createdAt`) is promoted to `confirmed`.

### Out of Scope

_(truncated on the card — see 'Full Description' checklist item, which doesn't exist; see Clarification 5)_

## Acceptance Criteria

**What the user sees:**

- [ ] Promotion is invisible to the cancelling employee — they see only the standard cancellation success message
- [ ] A waitlisted employee who refreshes the sessions page after being promoted sees their status shown as "Confirmed" instead of "Waitlisted"
- [ ] The session card's registered/capacity count stays the same after promotion (the vacated seat is immediately filled)
- [ ] A notification is sent to the promoted employee (WH-8) — _deferred to WH-8, see Clarification 2_

**API and backend behaviour:**

- [ ] When a confirmed registration is cancelled, the first waitlisted employee is automatically promoted to `confirmed`
- [ ] If there are no waitlisted employees, no promotion occurs and the `registered` count decrements by 1
- [ ] The session's `registered` count remains unchanged when promotion occurs (cancelled −1 and promoted +1 = net zero)
- [ ] Promotion is atomic: cancellation and promotion happen in the same database transaction
- [ ] The API response for cancellation includes `{ status: "cancelled", promotedRegistrationId: N }` if a promotion occurred, or `{ status: "cancelled", promotedRegistrationId: null }` if none

## Clarifications

Agreed with the user at kickoff (2026-11-13) and posted on the card:

1. **How the promoted employee sees "Confirmed":** a new `GET /api/training-sessions/:id/registrations/:registrationId` returns `{ id, status }`. On load, the session card fetches the current status for any registration saved in localStorage, updates its saved copy, and shows a "Waitlisted" / "Confirmed" label. It uses the same ID-as-identity model as WH-4; WH-12 adds the cancellation token later. Unknown IDs, or IDs from another session, return 404 `{ error: "Registration not found" }`.
2. **Notification (WH-8):** out of scope. `cancelRegistration` returns `promotedRegistrationId`, which WH-8 can use to send the notification.
3. **Promotion order:** the earliest waitlisted registration by `createdAt`, with `id` as the tie-break.
4. **Cancelling a waitlisted registration** doesn't promote anyone and doesn't change `registered`. Only cancelling a confirmed registration triggers a promotion.
5. **Out of Scope** (assumed, because the card's section is cut off): notifications (WH-8), the audit log (WH-9), the organiser view (WH-6), and auth/tokens (WH-12).
6. **WH-10** is an exact duplicate of this card. It's archived, with a pointer here.

## Domain Concept Identification

### Existing Concepts (from codebase)

- **Training session**: a scheduled workshop with a fixed `capacity` and a stored `registered` counter. `registered` counts **confirmed** registrations only; the waitlisted count is derived when the session is read. WH-5 must keep `registered` truthful without changing how either number is calculated.
- **Registration**: one employee's claim on one session, with a lifecycle status of `confirmed`, `waitlisted` or `cancelled` (a free-text column; the allowed values are defined in the service). WH-5 adds one transition, `waitlisted → confirmed`, alongside WH-4's `confirmed → cancelled` and `waitlisted → cancelled`.
- **Waitlist**: not a table. It's the set of a session's `waitlisted` registrations, ordered by `createdAt` with `id` as the tie-break. WH-3 already uses exactly that order to compute a newcomer's position, so "first on the waitlist" has one existing definition to reuse.
- **Cancellation (WH-4)**: an atomic unit of work that checks the registration belongs to the session, flips its status only if it hasn't changed since it was read, and, for a confirmed seat, decrements `registered` and calls the **promotion hook**. The hook exists as a private service step inside the same transaction and currently does nothing. WH-4's design explicitly left it so WH-5 changes only that step plus the result shape.
- **"My registration" (browser-side)**: WH-4 stores, per session, the employee's registration ID, last known status and the session's `createdAt` (a reseed guard) in localStorage. It's the only record the UI has of who the viewer is. Its status is written when the employee registers or cancels and is never refreshed, so a promotion that happens to someone else's action can't reach it today.
- **Error contract**: services throw `{ status, error }` objects; routes map them to HTTP. An ID that's malformed, unknown or belongs to another session all give 404 `"Registration not found"` on the WH-4 endpoint.

### New Concepts Required

- **Promotion (status transition)**: `waitlisted → confirmed` for the first registration on a session's waitlist, applied inside the cancellation that freed the seat. It **transfers** the freed seat rather than releasing it and claiming it again, so the session's seat count is unchanged when it happens.
- **Promoted registration reference**: the cancellation's result names which registration (if any) was promoted. The API returns it to the caller, and it's the hand-off point for WH-8's notification.
- **Registration status lookup**: a read-only way for the browser to ask "what is the current status of registration N in session S?". It's how a promoted employee learns about the promotion on their next page load. It reveals status only, not the name or email.
- **Status label on the session card**: a visible "Waitlisted" / "Confirmed" indicator for the viewer's own registration. Today the card shows only a Cancel button (confirmed) or a disabled "Cancelled" button, and nothing for a waitlisted registration.

### Key Business Rules

- **Only a freed confirmed seat triggers a promotion** (Clarification 4): cancelling a waitlisted registration never promotes and never changes `registered`. _Governs: Cancellation, Promotion._
- **First come, first served**: the promoted registration is the earliest `waitlisted` one for **that session** by `createdAt`, then `id`. Cancelled registrations, and those from other sessions, are never candidates. _Governs: Waitlist, Promotion._
- **Exactly one promotion per freed seat**: one confirmed cancellation promotes at most one registration. _Governs: Promotion._
- **Seat accounting**: if a promotion happens, `registered` is unchanged; if nothing is waitlisted, `registered` drops by exactly 1. In both cases `registered` equals the number of confirmed registrations and never exceeds `capacity` through this flow. _Governs: Training session, Promotion._
- **All or nothing**: the cancellation, the seat accounting and the promotion commit together or not at all. _Governs: Cancellation, Promotion._
- **Promotion is invisible to the canceller**: their success message is unchanged. The extra field in the API response is for the client and WH-8, not shown to them. _Governs: Cancellation UI._
- **Implicit: promotion doesn't change the promoted employee's identity in the browser.** Their saved registration ID stays valid; only its status changes, and their device learns the new status from the server rather than from its own copy. _Governs: "My registration", status lookup._
- **Implicit: the remaining waitlist shifts up.** Positions aren't stored (WH-3 computes them at registration time), so nothing needs updating. The waitlisted count on the card goes down by 1 when a promotion happens. _Governs: Waitlist, Training session view._
- **Implicit: the status lookup follows WH-4's identity model**: anyone who knows (or guesses) a registration ID can read its status. That's accepted for now and is the same exposure WH-12 is due to close for cancellation. _Governs: status lookup._

## Strategic Approach

### Solution Direction

- **Backend:** fill in WH-4's existing promotion hook. Inside the cancellation transaction, after a confirmed registration is flipped to cancelled, find the session's first waitlisted registration. If there is one, flip it to confirmed, guarded on its status so a concurrent change can't be overwritten, and leave `registered` as it is. If there isn't, decrement `registered` as WH-4 does today. The service result, and the 200 response, then carry the promoted registration's ID or null.
- **Status lookup:** a thin new read route on the existing training-sessions router, backed by a new service read. It keeps routes free of database access, reuses the WH-4 rule that a malformed, unknown or cross-session ID is a 404, and returns only the ID and status.
- **Frontend:** when the session card mounts with a saved registration, it asks the server for that registration's current status, updates the saved copy, and renders a status label. "Confirmed" (whether original or promoted) shows the existing Cancel flow; "Waitlisted" shows a label. A 404 forgets the saved registration, as WH-4's cancel path already does. The canceller's flow is unchanged apart from tolerating the extra response field.
- **Data flow:** DELETE → service cancellation (one transaction: verify, flip, transfer the seat or decrement, return the promoted ID) → route returns the status and the promoted ID → the page refetches sessions (`registered` unchanged, waitlisted count down by 1). Later, the promoted employee loads the page → the card checks its saved registration → status lookup → "Confirmed" label and Cancel button.
- **Testing**, following the repo's conventions: one integration test file per acceptance criterion (`wh5-*`), plus unit tests on the mocked Prisma client for the service. Each file uses its own `test-*` email prefix and restores session counters (and any seeded rows it changed) in `afterEach`.

### Key Design Decisions

- **Seat transfer vs "release, then claim"**:
  - _Release then claim_ follows the AC's wording ("−1 and +1 = net zero") and keeps WH-4's decrement untouched, but it briefly leaves an open seat inside the transaction and needs two counter writes.
  - _Transfer_ (skip the decrement when someone is promoted) has the same net effect with fewer writes and no window where the seat looks free.
  - → **Recommend transfer.** It states the invariant directly ("a freed seat goes straight to the next person") and doesn't rely on SQLite's single-writer locking to stop a concurrent new registration from grabbing the freed seat between the decrement and the promotion. On another database that window would be a real race. The AC's net-zero outcome is met either way.
- **Where "first on the waitlist" is defined**: WH-3 computes a newcomer's position by `createdAt` then `id`, and WH-5 needs the head of the same ordering. → **Recommend one shared definition of waitlist order**, so position and promotion can't disagree.
- **Promotion guard**: the candidate is flipped only if it's still `waitlisted` (the same conditional-update pattern WH-3 and WH-4 use). If that update matches nothing, the candidate changed concurrently, e.g. it was cancelled by its owner. → **Recommend trying the next candidate within the same transaction (a small bounded retry)**, rather than leaving the seat empty. Under SQLite's serialized writes this path should be essentially unreachable, so it's acceptable for the canvas to choose "fall back to decrementing" instead, as long as it's explicit.
- **Result shape**: extend the service result and the 200 body additively with `promotedRegistrationId` (number or null), always present. WH-4's design reserved this; existing callers and tests that only check `status` keep passing.
- **Status lookup scope**: return only the ID and status, with 404 for anything not found in that session. Not exposing the name or email limits what the ID-guessing exposure (WH-12) reveals. The route follows WH-4's strict positive-integer ID parsing.
- **When the browser syncs**: on card mount, and whenever the session data changes after a page refetch. That covers "refreshes the sessions page", which is the AC. → **No polling**: polling isn't asked for and would add load and complexity for a "next visit" requirement.
- **Label wording**: "Confirmed" and "Waitlisted", exactly as the AC says. Cancelled keeps WH-4's disabled "Cancelled" button. The waitlisted view gains a label only; whether waitlisted employees get a Cancel button is **not** in scope (see the risks below).

### Alternatives Considered

- **Database trigger or background job for promotion**: rejected. The AC requires promotion in the same transaction as the cancellation, Prisma with SQLite has no trigger tooling in this repo, and the WH-4 hook already exists for this.
- **Storing waitlist positions**: rejected. Positions are derived; storing them would need updating on every cancellation and promotion for no AC.
- **Pushing status to the browser (polling, SSE or WebSockets)**: rejected. The AC is satisfied on refresh, and none of this infrastructure exists.
- **Adding every registration's status to the session list endpoint**: rejected at kickoff. It would show every visitor every registration's status.
- **Showing the promotion to the canceller** (e.g. "your seat went to the next person"): rejected. The AC says promotion is invisible to them.
- **Doing WH-8's notification now** (even as a stub): rejected at kickoff. The returned promoted ID is the hand-off point.

## Risk & Gap Analysis

### Requirement Ambiguities

- **Out of Scope is missing on the card.** It's assumed per Clarification 5 (WH-6, WH-8, WH-9 and WH-12 are out). If the course meant something else, e.g. "no UI changes", the status label and the lookup would be out too.
- **"Sees their status shown as 'Confirmed' instead of 'Waitlisted'"** assumes a "Waitlisted" status display that doesn't exist yet. WH-5 introduces both labels. It's not specified whether the waitlist position should also show (e.g. "Waitlisted (#2)"). Position isn't stored, and its derived value changes as people ahead cancel. → Assume the label only, no position.
- **Should a waitlisted employee see a Cancel button?** WH-4 lets the API cancel waitlisted registrations but only shows Cancel for confirmed ones. WH-5's new label puts waitlisted employees in front of the same question. → Out of scope unless the user says otherwise. This needs a decision in the canvas.
- **AC wording "−1 and +1 = net zero"** reads like an implementation recipe. The transfer approach meets the observable outcome (`registered` unchanged), not the literal two steps. This should be confirmed if anyone reads the AC literally.
- **"Notification is sent (WH-8)"** stays unticked and is deferred. The story can't be fully "Done" against its card text without WH-8, so this should be recorded on the card when closing.

### Edge Cases

- **No one waitlisted**: behaves exactly like WH-4 (decrement, promoted ID null). Already covered by WH-4's tests, which must still pass.
- **Cancelling a waitlisted registration while others wait**: no promotion, `registered` unchanged, and the waitlist shrinks by 1 (Clarification 4).
- **Several waitlisted with the same `createdAt`** (same millisecond): `id` breaks the tie. A test should create registrations quickly enough to make this plausible, or check the ordering rule directly.
- **Registrations from other sessions, or cancelled ones, on the waitlist**: never candidates. Both should be tested, because the waitlist is a filter over one shared table.
- **Promoting into a session whose counter has drifted** (`registered` above `capacity` or out of step with the confirmed rows, from earlier test leaks or manual edits): transfer keeps `registered` unchanged, so drift persists but doesn't get worse. WH-4's `registered > 0` guard still applies on the no-promotion path.
- **Two confirmed cancels at once, with one waitlisted person**: exactly one promotion; the other cancel decrements. SQLite serializes the writes, but the logic must stay correct if they interleave (the conditional flips guarantee it).
- **The promoted employee's browser is still open on the page from before**: they see "Waitlisted" until a refresh or refetch. That's acceptable under the AC ("who refreshes").
- **A reseeded database** (WH-4's `createdAt` guard): a saved ID from before the reseed is discarded before any lookup. A lookup returning 404 also discards it.
- **A status lookup for a registration the viewer cancelled**: returns `cancelled`, and the card keeps showing "Cancelled".
- **The canceller and the promoted employee on the same browser** (e.g. a tester using two identities): the local registry stores one registration per session, so only one identity is visible per browser. This is a limitation of WH-4's design and matters mainly for manual UI testing.

### Technical Risks

- **Shared dev database in tests**: WH-5 integration tests need a session with confirmed **and** waitlisted registrations. The purpose-built full fixture (capacity 2, registered 2) is held by two **seeded** confirmed registrations, not `test-*` ones. A test that cancels a seeded registration must restore its status and the counter, or later suites (and `make dev`) see a corrupted fixture. → Prefer creating `test-*` confirmed registrations in a non-full session, filling it, then waitlisting `test-*` registrations, and restore counters afterwards, following the WH-4 pattern. The canvas should specify fixture setup precisely.
- **Existing WH-4 tests could change outcome**: any WH-4 test that cancels a confirmed seat in a session that happens to have waitlisted rows would now see a promotion instead of a decrement. Today's `test-*` cleanup and `maxWorkers: 1` make leftover waitlisted rows unlikely. The WH-4 "decrements" tests should be checked to make sure they use a session with an empty waitlist.
- **The unit-test mock grows**: the service's Prisma mock needs the queries promotion adds (finding the first waitlisted registration and the conditional flip). The existing `cancelRegistration` unit tests assume the hook makes no writes and may need adjusting. That's expected, not cheating: the behaviour they pin has changed by design.
- **The status lookup widens the ID-guessing exposure**: it lets anyone read any registration's status by ID. It's low sensitivity (status only), but it adds to WH-12's scope. WH-12's card should list the lookup as a second endpoint that needs the token.
- **Frontend has no test runner**: the label, the sync on load and the 404-forget path are verified manually only, the same gap as WH-4's UI. The riskiest part is the sync logic deciding which status to trust.
- **Types are now checked**: since WH-13, `make typecheck` covers the app. The extended `CancelRegistrationResponse` and any new status-lookup type must type-check, and the per-edit lint hook reports `any`.

### Acceptance Criteria Coverage

| AC# | Description                                                                       | Addressable?     | Gaps/Notes                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Promotion is invisible to the cancelling employee — standard success message only | Yes              | The canceller UI ignores the new field; the message is unchanged. Manual UI check.                                                                                                                                                  |
| 2   | Promoted employee who refreshes sees "Confirmed" instead of "Waitlisted"          | Yes              | Needs the new status lookup, the sync on load and the new labels (Clarification 1). Manual UI check; the API part is integration-testable.                                                                                          |
| 3   | The card's registered/capacity count is unchanged after promotion                 | Yes              | Follows from the seat-transfer rule; testable through the session endpoint. The waitlisted count drops by 1 (worth noting in the UI check).                                                                                         |
| 4   | Notification sent to the promoted employee (WH-8)                                 | Partial (agreed) | Deferred to WH-8; WH-5 provides `promotedRegistrationId` as the hand-off point. Stays unticked with a note.                                                                                                                         |
| 5   | Confirmed cancellation promotes the first waitlisted employee                     | Yes              | Ordering by `createdAt` then `id` (Clarification 3); only same-session, waitlisted candidates.                                                                                                                                      |
| 6   | No waitlisted employees → no promotion, `registered` −1                           | Yes              | Existing WH-4 behaviour; WH-4 tests plus one WH-5 assertion that the promoted ID is null.                                                                                                                                           |
| 7   | `registered` unchanged when a promotion occurs                                    | Yes              | Seat transfer; integration test that reads the counter before and after.                                                                                                                                                            |
| 8   | Promotion is atomic with the cancellation (same transaction)                      | Yes              | WH-4's hook already runs inside the transaction. Hard to prove atomicity end to end; a unit test can assert that promotion uses the transaction client, and a forced failure inside promotion can show the cancellation rolls back. |
| 9   | Response includes `promotedRegistrationId: N` or `null`                           | Yes              | Additive change to the service result and the route body; WH-4's 200 tests still pass.                                                                                                                                              |
