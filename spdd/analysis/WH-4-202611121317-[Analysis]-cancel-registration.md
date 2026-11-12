# SPDD Analysis: Employee Cancels a Training Session Registration (WH-4)

## Original Business Requirement

WH-4: Cancel registration (Trello https://trello.com/c/j5rWlYmr). Full card text:

## Context

An employee may need to cancel their confirmed registration. This frees up a seat that can be offered to the first person on the waitlist (WH-5). Cancellation should update the `registered` count and trigger waitlist promotion.

## Description

As a registered employee, I want to cancel my registration so that I can release my place for someone else.
The employee cancels using their registration ID. The system marks the registration as cancelled, decrements the registered count, and shows the updated state in the UI.

## Acceptance Criteria

**User interactions:**

- A "Cancel Registration" button is visible on the session card or registration confirmation page for an employee who has a confirmed registration
- Clicking "Cancel" shows a confirmation prompt: "Are you sure you want to cancel your registration for [Session Title]?"
- After confirming, the page shows a success message: "Your registration has been cancelled"
- The session card updates to reflect the new registered/capacity count (e.g., "11 / 20 registered (9 spots left)")
- If the employee has already cancelled, the Cancel button is not shown (or is disabled with label "Cancelled")
  **API behaviour:**
- `DELETE /api/training-sessions/:id/registrations/:registrationId` returns HTTP 200 with `{ status: "cancelled" }`
- On cancellation, the registration status changes to `cancelled` in the database
- On cancellation, the session's `registered` count decrements by 1
- Returns HTTP 404 if the registration does not exist
- Returns HTTP 409 if the registration is already cancelled
- After cancellation, waitlist promotion (WH-5) is triggered

## Out of Scope

- Email confirmation of cancellation (WH-8)
- Cancellation by organiser
- Authentication — the registration ID serves as the identity token for training simplicity

## Suggested Tests

- `DELETE /api/.../registrations/1` → 200, status "cancelled"
- `DELETE /api/.../registrations/999` → 404
- `DELETE` already-cancelled registration → 409
- `registered` count decrements after cancellation
- Waitlist promotion triggered after cancellation

## Clarifications (decided 2026-11-12)

Agreed with the product owner after the first analysis pass, and posted on the Trello card. They supersede the matching open questions further down.

1. **Waitlisted registrations can be cancelled.** `DELETE` accepts both `confirmed` and `waitlisted` registrations. Cancelling a waitlisted one frees no seat (`registered` is unchanged) and moves everyone behind it up one place. WH-3's 202 response gains the registration `id` (additive: `{ status: "waitlisted", position, id }`) so a waitlisted employee has something to cancel with. The UI's "Cancel Registration" button still targets confirmed registrations, as AC 1 says.
2. **WH-4 adds only the promotion hook.** Cancellation calls a promotion step inside the same transaction, which does nothing until WH-5 fills it in. WH-5 owns the promotion behaviour, the `promotedRegistrationId` response field and its tests. WH-4's response stays `{ status: "cancelled" }`.
3. **The browser remembers "my registration" in `localStorage`.** It's keyed by session and survives reloads. A 409 or 404 on cancel clears or marks the saved entry instead of showing an error. Because the dev DB is reseeded often (`make reset-db`), a saved ID can come to point at someone else's registration. The canvas's Safeguards must address this, either by having the UI check the saved name/email against the server before offering the button, or by explicitly accepting the risk for training.

## Domain Concept Identification

### Existing Concepts (from codebase)

- **TrainingSession**: a scheduled training event with a fixed capacity. It owns a denormalised `registered` counter that counts _confirmed_ registrations only and is the authority for "is there a free seat". WH-3 made the counter the capacity gate: a seat is claimed with a conditional increment that can never pass `capacity`. The waitlisted count is not stored; it's derived from registrations at read time.
- **Registration**: one employee's claim on a session (name, email, status, createdAt). It belongs to exactly one TrainingSession (cascade-deleted with it). The status lifecycle is already declared in the schema and service constants as `confirmed | waitlisted | cancelled`, with `cancelled` explicitly reserved for WH-4. Nothing in the codebase produces `cancelled` yet.
- **Waitlist position**: not stored. It's derived from waitlisted registrations of a session ordered by `createdAt`, then `id`. Any status change on a waitlisted registration implicitly shifts the positions of those behind it.
- **Registration service layer** (`trainingSessionService`): the only place that touches Prisma for sessions/registrations, per the team norm "no direct Prisma in routes". It signals business errors by throwing `{ status, error }` objects that the route maps straight to HTTP responses.
- **Session card (UI)**: renders `registered / capacity`, the waitlisted count and spots left; registers or joins the waitlist via an inline form, then asks the page to refetch so counts are server-authoritative. It keeps **no record** of the registration it just created: after success it shows a message and clears the form.

### New Concepts Required

- **Cancellation (status transition)**: the `confirmed → cancelled` transition and its side effects: free one seat (decrement `registered`) and hand the seat to WH-5's promotion. It's a soft state change, not a row deletion, so history survives for WH-6 (organiser view, which must hide cancelled rows) and WH-9 (audit log).
- **Registration held by the employee (client-side identity)**: the UI must remember which registration(s) _this browser_ created, because the registration ID is the only identity token (no auth, by the Out of Scope rule). This concept doesn't exist today and is the precondition for the "Cancel Registration" button appearing at all.
- **Promotion hook**: a defined point in the cancellation flow, inside the same unit of work, where WH-5's "promote the first waitlisted registration" plugs in. WH-4 owns the seam; WH-5 owns the behaviour.

### Key Business Rules

- **Only an active registration can be cancelled**: `cancelled` is terminal; cancelling it again is a conflict (409), not a silent success. Governs Registration.
- **The counter tracks confirmed seats only**: cancelling a _confirmed_ registration decrements `registered` by exactly 1; the counter must never go below 0 or drift from the number of confirmed rows. Governs TrainingSession, Registration.
- **A registration belongs to the session in the URL**: a registration ID that exists but belongs to a different session must be treated as not found for that path. Otherwise the session in the URL is meaningless and counters of the wrong session could be touched. (Implicit.) Governs both.
- **Cancellation and its seat accounting are atomic**: the status change, the counter decrement and (later) the promotion happen together or not at all, mirroring how WH-3 claims seats. (Implicit for WH-4; explicit in WH-5.) Governs both.
- **Cancelled registrations are invisible to capacity and waitlist maths**: they count neither toward `registered` nor the derived waitlisted count or positions. (Implicit; already true for the waitlisted count because it filters by status.) Governs Registration, waitlist position.
- **Cancelling a waitlisted registration** frees no seat and must not touch `registered`, but it does move everyone behind it up one position. Allowed (Clarification 1). Governs Registration, waitlist position.

## Strategic Approach

### Solution Direction

- Follow the shape WH-3 established: **thin Express route → service function → single Prisma transaction**. The route parses both IDs and maps service-thrown `{ status, error }` to HTTP; the service owns validation, existence/ownership checks, the state transition and the counter, all in one transaction.
- **Data flow:** `DELETE /api/training-sessions/:id/registrations/:registrationId` → service "cancel registration" → in one transaction: confirm the registration exists under that session and is still active, flip it to `cancelled` _conditionally on its current status_, decrement the session counter if it was confirmed, then call the promotion hook (a no-op until WH-5) → 200 `{ status: "cancelled" }`.
- **UI:** the session card learns about "my registration" from the registration POST response, offers "Cancel Registration" while that registration is confirmed, confirms with the exact prompt text, calls DELETE, shows the success message, and reuses the existing `onRegistered` refetch so the capacity line updates from the server.
- **Tests:** mirror WH-3's layout: one integration test file per API acceptance criterion (`wh4-*.test.ts`, Jest + Supertest against the shared dev DB, cleaning up `test-*` rows and restoring counters), plus unit tests on the service with the mocked Prisma client.

### Key Design Decisions

- **Soft-cancel (status update) vs. deleting the row**: deleting is simpler but loses history that WH-6/WH-9 need and makes a repeat cancel return 404 instead of the required 409 → **soft-cancel**, as the AC and schema comment already imply.
- **How to make "already cancelled → 409" race-safe**: a read-then-write check lets two simultaneous cancels both pass and decrement twice. A conditional update keyed on the current status lets the database decide, exactly like WH-3's capacity claim → **conditional status transition inside the transaction**; the number of rows affected decides between success and 409.
- **Where promotion lives**: implementing WH-5 inside WH-4 blurs story boundaries and its response shape (`promotedRegistrationId`); doing nothing leaves WH-5 to restructure the transaction → **WH-4 adds the in-transaction hook only** and returns `{ status: "cancelled" }`; WH-5 fills the hook and extends the response additively. The "promotion is triggered" AC is satisfied at the seam level and verified fully in WH-5 (decided, Clarification 2).
- **How the UI knows the employee's registration**: (a) in-memory component state: simplest, but lost on page reload, so the button disappears after any refresh; (b) browser `localStorage` keyed by session: survives reloads and matches "registration ID is the identity token", at the cost of a little persistence logic; (c) a lookup-by-email endpoint: real identity semantics, but it's new API surface that isn't in the ACs and invites enumeration → **(b) localStorage**, recommended because the AC "If the employee has already cancelled, the button is not shown/disabled" only makes sense if the client remembers state across the refresh it triggers itself. Decided (Clarification 3).
- **Non-numeric `:id` / `:registrationId`**: `GET /:id` returns 400 for a non-numeric id, while `POST /:id/registrations` deliberately returns 404 (pinned by a test) → **404 for the DELETE**, consistent with its sibling sub-resource route and the "doesn't exist" wording of the AC.
- **Confirmation prompt**: native `window.confirm` (zero UI code, hard to test and style) vs. an inline confirm step in the card (consistent with the inline register form) → **inline confirm step**, so the exact prompt text is in the DOM and testable.

### Alternatives Considered

- **`PATCH` the registration status instead of `DELETE`**: more RESTful for a soft state change, but the AC fixes the verb and path. Rejected.
- **Recomputing `registered` from confirmed rows instead of decrementing**: removes drift risk, but reverses WH-3's counter-as-capacity-gate design and changes read paths. Rejected for this story; worth noting as a future simplification.
- **Separate "My registrations" page**: the AC allows a "registration confirmation page", but nothing like it exists; the card is where registration already happens. Rejected as unnecessary new surface.
- **Implementing WH-5 promotion now**: the WH-4 card says promotion "is triggered", and WH-5 (plus its duplicate WH-10) owns the behaviour, response field and tests. Rejected to keep stories independently reviewable.

## Risk & Gap Analysis

### Requirement Ambiguities

- ~~**Can a _waitlisted_ registration be cancelled?**~~ **Resolved (Clarification 1):** yes at the API; the 202 body gains the registration `id`; the UI button stays on confirmed registrations.
- ~~**What does "promotion is triggered" mean for WH-4's done-ness?**~~ **Resolved (Clarification 2):** hook only. The suggested test "Waitlist promotion triggered after cancellation" becomes a WH-5 test; WH-4 can at most verify that the hook runs inside the cancellation transaction.
- **Registration ID belonging to a different session**: not covered by any AC. Recommendation: 404.
- **Which page shows the button?** "session card or registration confirmation page". There's no confirmation page today; recommend the card.
- **"Cancelled" label vs. hidden button**: the AC allows either. With localStorage, a "Cancelled" disabled label is cheap and clearer; confirm preference.
- **Response body on 404/409**: the existing convention is `{ error: string }`; the AC only fixes the 200 body. Assume `{ error }` with specific messages.
- **Story duplication**: WH-5 and WH-10 are the same story (already on the course feedback card); WH-4 hands off to "WH-5" in its text.

### Edge Cases

- **Double cancel (two tabs, double click, retries)**: must yield exactly one 200 and one 409, with a single decrement. This is the main correctness risk; it's why the status transition must be conditional inside the transaction.
- **Cancel that races a new registration**: a seat freed by cancellation can be claimed by a concurrent POST before or after the counter changes; the conditional-increment design keeps the counter within `capacity` either way. Once WH-5 lands, promotion should take the freed seat before a new walk-in can (ordering rule for WH-5).
- **Counter already 0 or out of sync with confirmed rows** (e.g. pre-WH-3 data, or the drift the WH-3 test leak caused): the decrement must not take `registered` below 0.
- **Registration for a deleted session**: rows cascade-delete, so this collapses to 404.
- **Non-numeric, negative or huge IDs**: 404, consistent with POST.
- **localStorage stale or cleared**: if the browser forgets, the employee loses the button (acceptable, since the no-auth trade-off is out of scope). If the stored registration was cancelled elsewhere, the DELETE returns 409; the UI should then treat it as already cancelled rather than as an error.
- **Same browser registers twice for one session** (duplicate prevention is out of scope per WH-2): the UI must decide which registration the button cancels. Recommend tracking the most recent one per session.

### Technical Risks

- **Anyone can cancel anyone (insecure direct object reference)**: IDs are sequential integers and authentication is explicitly out of scope, so `DELETE …/registrations/1..N` cancels every registration. That's accepted for training, but should be stated in the canvas's Safeguards. The course's Workshop 8 is security-focused, and this endpoint is a likely target. Scoping the ID to the session in the URL narrows it slightly, but doesn't fix it.
- **Saved IDs outlive a reseed**: with `localStorage` (Clarification 3), `make reset-db` or `make seed` can reuse registration IDs, so a saved ID may point at a different person's registration and "Cancel Registration" would cancel it. This is an issue for the Safeguards section: either verify the saved name/email against the server before offering the button, or accept the risk explicitly for training.
- **Shared dev DB in integration tests**: tests run against `api/database/workshophub.sqlite` with `maxWorkers: 1`. Cancel tests need a confirmed registration to cancel, and must restore the counter even when assertions fail (the WH-3 test-leak lesson). A cancel test that never re-increments will make sessions look emptier on every run.
- **Interaction with WH-3's position calculation**: positions are computed among `waitlisted` rows only, so cancelled rows drop out automatically. No change is needed, but a regression test is cheap.
- **Frontend label collision**: the card already has a "Cancel" button that closes the registration form. A second "Cancel" (registration) next to it is a usability and test-selector hazard; use distinct labels ("Cancel Registration", and "Keep my registration"/"Yes, cancel" in the confirm step).
- **Team norms**: the new route must call the service only (no Prisma import usage beyond the pre-existing Workshop 8 `/search` seed), no `any` in thrown-error handling (follow the existing `as { status?: number; error?: string }` narrowing), and `make test` + `make lint` must pass.

### Acceptance Criteria Coverage

| AC# | Description                                                                             | Addressable?     | Gaps/Notes                                                                                                                 |
| --- | --------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | "Cancel Registration" button visible for an employee with a confirmed registration      | Yes              | Button on the card; "my registration" kept in `localStorage` (Clarification 3). No confirmation page exists.               |
| 2   | Clicking shows "Are you sure you want to cancel your registration for [Session Title]?" | Yes              | Inline confirm step recommended over `window.confirm` for testability.                                                     |
| 3   | After confirming, shows "Your registration has been cancelled"                          | Yes              | Reuses the card's existing success-message slot.                                                                           |
| 4   | Card updates to the new registered/capacity count                                       | Yes              | Reuse the existing `onRegistered` page refetch; the count format already matches the example.                              |
| 5   | Already cancelled → button hidden, or disabled with "Cancelled"                         | Yes              | `localStorage` keeps the state across reloads; a 409 or 404 from a stale saved entry marks or clears it (Clarification 3). |
| 6   | `DELETE …/registrations/:registrationId` → 200 `{ status: "cancelled" }`                | Yes              | WH-5 will later add `promotedRegistrationId`; keep the body extensible.                                                    |
| 7   | Registration status becomes `cancelled` in the DB                                       | Yes              | Soft update; the status value is already reserved in schema and constants.                                                 |
| 8   | Session `registered` decrements by 1                                                    | Yes              | Only for confirmed registrations; must not go below 0; must be in the same transaction.                                    |
| 9   | 404 if the registration doesn't exist                                                   | Yes              | Recommend extending to "exists but belongs to another session" and non-numeric IDs.                                        |
| 10  | 409 if already cancelled                                                                | Yes              | Must be race-safe (conditional transition), not read-then-write.                                                           |
| 11  | Waitlist promotion (WH-5) is triggered                                                  | Partial (agreed) | WH-4 provides the in-transaction hook only; promotion and its assertion belong to WH-5 (Clarification 2).                  |
