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

- [x] Promotion is invisible to the cancelling employee — they see only the standard cancellation success message
- [x] A waitlisted employee who refreshes the sessions page after being promoted sees their status shown as "Confirmed" instead of "Waitlisted"
- [x] The session card's registered/capacity count stays the same after promotion (the vacated seat is immediately filled)
- [ ] A notification is sent to the promoted employee (WH-8) — _deferred to WH-8, see Clarification 2_

**API and backend behaviour:**

- [x] When a confirmed registration is cancelled, the first waitlisted employee is automatically promoted to `confirmed`
- [x] If there are no waitlisted employees, no promotion occurs and the `registered` count decrements by 1
- [x] The session's `registered` count remains unchanged when promotion occurs (cancelled −1 and promoted +1 = net zero)
- [x] Promotion is atomic: cancellation and promotion happen in the same database transaction
- [x] The API response for cancellation includes `{ status: "cancelled", promotedRegistrationId: N }` if a promotion occurred, or `{ status: "cancelled", promotedRegistrationId: null }` if none

## Clarifications

Agreed with the user at kickoff (2026-11-13) and posted on the card:

1. **How the promoted employee sees "Confirmed":** a new `GET /api/training-sessions/:id/registrations/:registrationId` returns `{ id, status }`. On load, the session card fetches the current status for any registration saved in localStorage, updates its saved copy, and shows a "Waitlisted" / "Confirmed" label. It uses the same ID-as-identity model as WH-4; WH-12 adds the cancellation token later. Unknown IDs, or IDs from another session, return 404 `{ error: "Registration not found" }`.
2. **Notification (WH-8):** out of scope. `cancelRegistration` returns `promotedRegistrationId`, which WH-8 can use to send the notification.
3. **Promotion order:** the earliest waitlisted registration by `createdAt`, with `id` as the tie-break.
4. **Cancelling a waitlisted registration** doesn't promote anyone and doesn't change `registered`. Only cancelling a confirmed registration triggers a promotion.
5. **Out of Scope** (assumed, because the card's section is cut off): notifications (WH-8), the audit log (WH-9), the organiser view (WH-6), and auth/tokens (WH-12).
6. **WH-10** is an exact duplicate of this card. It's archived, with a pointer here.
