# WH-3: Waitlist when a training session is full

- **List:** IN PROGRESS
- **Labels:** orange (unnamed)
- **Members:** Unassigned
- **Card:** https://trello.com/c/9miCZjr6/7-wh-3-waitlist-when-a-training-session-is-full

## Description

### Context

After WH-2 is implemented, a session can fill up. When a session reaches capacity, subsequent employees who want to attend should be placed on a waitlist rather than being turned away. This ensures demand is captured and can be fulfilled if a registered employee cancels (WH-4 → WH-5).

### Story

As an employee, I want to join a waitlist for a full training session so that I can attend if a place becomes available.

When a session is full, an employee can join the waitlist. The system records their position and informs them they are waitlisted, not confirmed.

### Out of Scope

- Promotion from waitlist (WH-5)
- Cancellation (WH-4)
- Email notification (WH-8)
- Maximum waitlist size

### Suggested Tests

- `POST` when session is full → 202 with `status: "waitlisted"`
- `POST` when session has space → 201 with `status: "confirmed"`
- Waitlisted count is tracked separately from registered count
- Position in waitlist is correct (1st, 2nd, etc.)

### Data Model Hint

The `Registration` model should include a `status` field: `confirmed | waitlisted | cancelled`.

## Acceptance Criteria

- [ ] When `registered >= capacity`, new registrations are added to the waitlist
- [ ] The waitlisted employee sees a message confirming they are waitlisted (not confirmed)
- [ ] The session card shows a "Join Waitlist" option when the session is full
- [ ] `POST /api/training-sessions/:id/registrations` returns HTTP 202 with `{ status: "waitlisted", position: N }` when full
- [ ] Waitlisted registrations have status `waitlisted` in the database
- [ ] Confirmed registrations have status `confirmed`

## Clarifications

1. **Acceptance criteria:** all six are ticked on the card, but none are implemented. They're unticked here so they track progress on this branch.
2. **Full session → 202, not 409:** WH-3 replaces WH-2's "409 when full". A full session always waitlists. Update the existing WH-2 test that expects 409.
3. **Waitlisted count:** `GET /api/training-sessions` and `GET /api/training-sessions/:id` return a `waitlisted` count next to `registered`. `registered` counts confirmed registrations only.
4. **UI when full:** keep the same name + email form; its button reads "Join Waitlist" instead of being disabled. This replaces WH-2's "disable when full".

All four were posted as a comment on the card.
