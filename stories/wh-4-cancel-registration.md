# WH-4: Cancel registration

- **List:** IN PROGRESS
- **Labels:** orange (unnamed)
- **Members:** Unassigned
- **Card:** https://trello.com/c/j5rWlYmr/2-wh-4-cancel-registration

## Description

### Context

An employee may need to cancel their confirmed registration. This frees up a seat that can be offered to the first person on the waitlist (WH-5). Cancellation should update the `registered` count and trigger waitlist promotion.

### Story

As a registered employee, I want to cancel my registration so that I can release my place for someone else.

The employee cancels using their registration ID. The system marks the registration as cancelled, decrements the registered count, and shows the updated state in the UI.

### Out of Scope

- Email confirmation of cancellation (WH-8)
- Cancellation by organiser
- Authentication — the registration ID serves as the identity token for training simplicity

### Suggested Tests

- `DELETE /api/.../registrations/1` → 200, status "cancelled"
- `DELETE /api/.../registrations/999` → 404
- `DELETE` already-cancelled registration → 409
- `registered` count decrements after cancellation
- Waitlist promotion triggered after cancellation

(Out of Scope and Suggested Tests come from the card's "Card Details" checklist, because the description is truncated.)

## Acceptance Criteria

**User interactions:** _(verified manually in the browser, 2026-11-12)_

- [x] A "Cancel Registration" button is visible on the session card or registration confirmation page for an employee who has a confirmed registration
- [x] Clicking "Cancel" shows a confirmation prompt: "Are you sure you want to cancel your registration for [Session Title]?"
- [x] After confirming, the page shows a success message: "Your registration has been cancelled"
- [x] The session card updates to reflect the new registered/capacity count (e.g., "11 / 20 registered (9 spots left)")
- [x] If the employee has already cancelled, the Cancel button is not shown (or is disabled with label "Cancelled")

**API behaviour:**

- [x] `DELETE /api/training-sessions/:id/registrations/:registrationId` returns HTTP 200 with `{ status: "cancelled" }`
- [x] On cancellation, the registration status changes to `cancelled` in the database
- [x] On cancellation, the session's `registered` count decrements by 1
- [x] Returns HTTP 404 if the registration does not exist
- [x] Returns HTTP 409 if the registration is already cancelled
- [ ] After cancellation, waitlist promotion (WH-5) is triggered. _WH-4 delivers only the promotion step (`promoteFromWaitlist`, called inside the cancellation transaction); WH-5 completes it._

## Clarifications

Decided 2026-11-12 during SPDD analysis (`spdd/analysis/WH-4-202611121317-[Analysis]-cancel-registration.md`) and posted as a comment on the card.

1. **Waitlisted registrations can be cancelled.** `DELETE` accepts `confirmed` and `waitlisted` registrations. Cancelling a waitlisted one leaves `registered` unchanged and moves those behind it up one place. WH-3's 202 response gains the registration `id`. The UI button stays on confirmed registrations (AC 1).
2. **WH-4 adds only the promotion hook.** Cancellation calls a promotion step in the same transaction, which does nothing until WH-5. WH-5 owns promotion, `promotedRegistrationId` and the "promotion triggered" test. WH-4's response stays `{ status: "cancelled" }`.
3. **The browser remembers "my registration" in `localStorage`** (per session, survives reloads). A 409 or 404 on cancel clears or marks the saved entry. Risk to address in the canvas's Safeguards: after `make reset-db` a saved ID can point at someone else's registration.
4. A registration ID that belongs to a different session returns 404; non-numeric IDs return 404 (same as POST); a second cancel returns 409 and must be race-safe.
