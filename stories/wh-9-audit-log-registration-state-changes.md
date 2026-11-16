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

- [ ] The organiser opens the session registrations page (WH-6) and identifies the registration ID they want to investigate _(Context only: the registrations page is WH-6)_
- [x] The organiser calls `GET /api/training-sessions/:id/registrations/:registrationId/audit` to see the full state history
- [x] The response shows a time-ordered list of transitions, e.g.:
  - `null → confirmed` (registered)
  - `confirmed → cancelled` (cancelled)
  - _(for a different registration)_ `null → waitlisted` then `waitlisted → confirmed` (promoted)
- [x] This gives the organiser a complete picture of every state a registration has been through

**Data and API behaviour:**

- [x] An `AuditLog` table is created with: `id`, `registrationId`, `fromStatus`, `toStatus`, `changedAt`, `reason` (optional string)
- [x] Every registration state change creates an audit log entry atomically within the same transaction
- [x] `GET /api/training-sessions/:id/registrations/:registrationId/audit` returns the full audit history in chronological order
- [x] Audit entries are immutable: they cannot be updated or deleted via the API
- [x] Returns HTTP 404 if the registration does not exist
- [x] The audit log captures all transitions: initial registration, promotion, cancellation

## Clarifications

None gathered. Kickoff ran unattended (deliver-story workflow, 2026-11-16) with no navigator to ask. Open questions, not answered:

1. **Out of Scope / Suggested Tests / hints:** the card's description is truncated after the acceptance criteria and the `Full Description` checklist item it points to does not exist on the card. Everything after `## Out of Scope` is unknown.
2. **WH-6 dependency:** the first acceptance criterion refers to the session registrations page (WH-6), which is still in To Do and not implemented. It is unconfirmed whether WH-9 is API-only, with that criterion treated as context rather than something to build.
