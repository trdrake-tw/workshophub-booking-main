# WH-8: Send notification after registration or waitlist promotion

- **List:** IN PROGRESS
- **Labels:** blue (unnamed)
- **Members:** Unassigned
- **Card:** https://trello.com/c/Vt7Qd4fX/5-wh-8-send-notification-after-registration-or-waitlist-promotion

## Description

### Context

Employees should receive feedback when they successfully register or are promoted from the waitlist. This confirmation helps them know their seat is secured without needing to check back.

This is a **trainee exercise story**. It is not implemented in the baseline template.

### Description

As an employee, I want to receive a notification when I register or am promoted from the waitlist so that I know my seat is confirmed.

For training simplicity, the in-app UI shows a success banner immediately after the action. A backend notification (console log or Slack webhook) fires as a side effect and does not block the response.

### Out of Scope

- Real email delivery
- SMS notifications
- Notification for cancellation
- Notification history or inbox

### Suggested Tests

- Registration success → success banner shown in UI
- Waitlist registration → waitlist banner shown in UI
- Registration success → notification logged with correct employee and session details
- Waitlist promotion → notification logged
- Notification failure does not affect API response
- Slack notification sent when `SLACK_WEBHOOK_URL` is set (optional, integration test)

### Implementation Hint

Use an event emitter or a simple async side-effect function. The core registration path should not `await` the notification.

Type: Story | Priority: Medium

## Acceptance Criteria

**User interactions (in-app feedback):**

- [ ] After successfully registering (confirmed), the page shows a success banner: "You're registered! [Session title] on [formatted date]"
- [ ] After joining the waitlist, the page shows: "You're on the waitlist for [Session title]. We'll let you know if a spot opens up."
- [ ] Both banners appear immediately after the form is submitted without a page reload
- [ ] The banners can be dismissed by the user or auto-dismiss after a few seconds
- [ ] If the backend notification fails, the banner still appears (notification failure is silent)

**Backend notification:**

- [ ] After a successful registration (`confirmed`), a notification event is emitted on the server
- [ ] After a waitlist promotion (`confirmed` via WH-5), a notification event is emitted on the server
- [ ] The notification includes: employee name, email, session title, session date, status (`confirmed` or `promoted`)
- [ ] For baseline: notification is logged to the server console
- [ ] Optional extension: if `SLACK_WEBHOOK_URL` is set in the environment, a Slack message is sent to the configured channel
- [ ] Notification failures must not fail the registration or promotion (fire-and-forget)

## Clarifications

Agreed with the navigator on 2026-11-15, after the SPDD analysis:

1. **Slack (AC 10):** deferred. Not implemented in WH-8.
2. **Waitlist banner:** keeps the waitlist position: "You're on the waitlist for [Session title] (position N). We'll let you know if a spot opens up."
3. **Banner criteria (AC 1–5):** verified manually. No frontend test framework is added.
4. **Dismissal:** banners are both dismissible by the user and auto-dismiss after about five seconds.
