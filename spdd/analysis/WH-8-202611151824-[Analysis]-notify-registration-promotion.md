# SPDD Analysis: Notify employees after registration or waitlist promotion

## Original Business Requirement

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

None

## Domain Concept Identification

### Existing Concepts (from codebase)

- **TrainingSession**: a bookable training session with a title, a date and a confirmed-seat counter. Supplies the session title and date that every notification and both banners quote.
- **Registration**: an employee's place on a session, holding their name, email and a status of confirmed, waitlisted or cancelled. Supplies the employee details for a notification. Owned by its TrainingSession.
- **Registration outcome**: creating a registration ends as either confirmed (a seat was claimed) or waitlisted (the session was full, with a position). The confirmed outcome is the first notification trigger; the two outcomes also select which banner the employee sees.
- **Waitlist promotion (WH-5)**: when a confirmed registration is cancelled, the earliest waitlisted registration becomes confirmed inside the same transaction as the cancellation. The cancellation result names the promoted registration by id only. This is the second notification trigger, and the hand-off WH-5 left for this story.
- **In-card feedback message**: the session card already shows a single status message after registering, joining the waitlist or cancelling. It has different wording from this story, stays until the next action, and cannot be dismissed. The banners in this story are an evolution of it, not a new surface.
- **My registration (browser-side memory)**: the card remembers the employee's registration per session and refreshes its status on load. This is how a promoted employee already sees "Confirmed" (WH-5); it is not a notification and is unchanged here.

### New Concepts Required

- **Notification**: a one-off message telling an employee their seat is secured. Carries who (name, email), what (session title, session date) and why (confirmed directly, or promoted from the waitlist). Derived from a Registration and its TrainingSession at the moment of the trigger; not stored.
- **Notification kind**: `confirmed` or `promoted`. This is a vocabulary for notifications only. `promoted` is not a registration status: a promoted registration's status is `confirmed`.
- **Notification channel**: where a notification is delivered. The baseline channel is the server console. Slack is an optional second channel that exists only when a webhook address is configured in the environment.
- **Notification dispatch**: the act of handing a notification to its channels after the business action has succeeded, without the caller waiting for it and without its failure reaching the caller.
- **Success banner**: the employee-facing confirmation with the story's exact wording, shown straight after the form is submitted, which the employee can dismiss or which disappears by itself.

### Key Business Rules

- **A confirmed registration triggers one `confirmed` notification**: governs Registration outcome and Notification.
- **A waitlist promotion triggers one `promoted` notification, addressed to the promoted employee, not the one who cancelled**: governs Waitlist promotion and Notification.
- **Joining the waitlist triggers a banner but no backend notification** (implicit: the backend criteria list only confirmed and promoted): governs Registration outcome, Success banner and Notification.
- **Cancellation triggers no notification** (explicit, out of scope): the cancelling employee's experience from WH-4/WH-5 is unchanged.
- **Notifications are sent only for outcomes that really happened** (implicit): a notification must follow a committed registration or promotion, never one that is later rolled back.
- **A notification can never change the outcome** (explicit): a failed, slow or misconfigured channel must not fail, delay or roll back the registration, the cancellation or the promotion, and must not change the API response.
- **Channel failures are independent** (implicit): Slack failing must not stop the console notification, and the reverse.
- **The banner depends only on the API response** (explicit): it appears whether or not the backend notification worked, because the browser never learns the notification's fate.
- **No notification record is kept** (explicit, out of scope): there is no history, inbox or retry.

## Strategic Approach

### Solution Direction

- Treat this as two loosely connected halves that share only wording about the same event: a **server-side notification side effect** and a **browser-side banner change**. Neither depends on the other at runtime, and no API response shape needs to change for the banners.
- Server side: introduce a small notification capability in the service layer, alongside the existing training-session service. The existing registration and cancellation flows call it after their transaction has committed, hand over what happened, and return without waiting. Flow: route (unchanged, thin) → service performs the business action → on success, service hands a notification to the dispatcher → dispatcher delivers to the console, and to Slack when configured → any failure is contained inside the dispatcher.
- Follow the conventions already in place: routes stay thin with no data access; all data access stays in the service layer; no `any`; integration tests through the HTTP API with `test-` emails and cleanup; unit tests with the data layer mocked.
- Browser side: change the wording of the two existing success messages on the session card to the story's text, using the card's existing date formatting, and add dismissal (a close control and a timed auto-dismiss) to that message area.
- Deliver through the project's one-slice TDD loop: each backend criterion is a slice with observable behaviour (what is logged, what the response is when a channel fails). Slack is the last, droppable slice.

### Key Design Decisions

- **Dispatch mechanism — plain async side-effect function vs event emitter**: an emitter decouples the trigger from the listeners but adds indirection, and a listener that throws synchronously surfaces in the emitting code path, which is exactly what must not happen. A plain dispatcher function is easier to make failure-proof and to observe in tests. → **Recommend a plain dispatcher with pluggable channels.** The card's hint allows either.
- **When to dispatch — inside the transaction vs after commit**: dispatching inside the transaction risks notifying for a registration or promotion that then rolls back, and holds the transaction open on I/O. → **Dispatch only after the transaction has committed.**
- **Where the trigger lives — route vs service**: the route knows the HTTP outcome but must stay thin; the service owns the business outcome and already has the data. → **Trigger from the service layer**, so any future caller of the same service operation gets the notification too.
- **Getting the promoted employee's details**: the cancellation result carries only the promoted registration's id, but the notification needs name, email, session title and date. Either the promotion step captures those details while it has the row, or the dispatcher looks them up afterwards. Capturing inside the transaction is consistent and avoids a second read; looking up afterwards keeps the transaction untouched but adds a read that can itself fail (silently, as a notification failure). → **Recommend the service gathers the details as part of the committed work and passes a complete notification to the dispatcher**, so the dispatcher never touches the database. The public cancellation response stays as it is.
- **Console notification format**: free text is readable but hard to assert on and open to log forging through a crafted name. A single structured line per notification is testable and safe. → **Recommend one structured, single-line entry per notification with an identifiable marker.**
- **Slack channel — include now, or defer**: it is marked optional. Including it adds an outbound network call, a secret, a timeout question and a test that must never reach the real Slack. → **Recommend including it as the final slice, behind the environment variable, tested with the network call replaced**; drop it without affecting the rest if time is short. Needs the navigator's decision (see ambiguities).
- **Banner — evolve the existing message area vs add a separate banner component**: the card already has one accessible status area used by register, waitlist and cancel. A second surface would show two confirmations. → **Evolve the existing area**: new wording for the two registration outcomes, plus dismissal. Cancellation messages share that area, so they would gain dismissal as well; keep their wording unchanged.
- **Verifying the UI criteria**: the frontend has no test framework; earlier stories verified UI criteria manually. Adding one is a tooling change beyond this story. → **Recommend manual verification of the banner criteria**, with the backend criteria covered by automated tests. Needs the navigator's agreement, because the `tdd` skill's agents only work under the API.

### Alternatives Considered

- **Persisting notifications (an outbox table with a worker)**: gives retries and delivery guarantees, but history and inbox are explicitly out of scope and it would need a schema change and a background process. Rejected as over-built for a console/Slack baseline.
- **Emitting the notification from the route handler after sending the response**: simple, but puts business side effects in the HTTP layer against the team's thin-routes norm, and misses any non-HTTP caller. Rejected.
- **Awaiting the notification but swallowing errors**: guarantees ordering in tests, but a slow Slack call would delay every registration response, contradicting "does not block the response". Rejected.
- **Returning notification status in the API response so the UI can report it**: contradicts "notification failure is silent" and couples the banner to the side effect. Rejected.
- **An in-app banner for the promoted employee**: they are not on the page when the promotion happens, and WH-5 already shows them "Confirmed" on their next visit. Not asked for by the card. Rejected.

## Risk & Gap Analysis

### Requirement Ambiguities

- **Is Slack in scope for this story?**: it is listed as an acceptance criterion but labelled "optional extension". Needs a yes/no before the canvas, since it decides whether an outbound call and a secret are introduced.
- **"A notification event is emitted"**: could mean a literal event on an emitter, or simply that a notification is produced. The baseline observable is a console entry; the analysis assumes that is what "emitted" must demonstrably result in.
- **Waitlisted registrations and the backend**: the banner says "We'll let you know if a spot opens up", but no backend notification is listed for joining the waitlist. Assumed intentional (banner only). Confirm.
- **Waitlist banner drops the position**: the current message tells the employee their waitlist position and that they are "not confirmed yet" (delivered for WH-3). The new wording has neither. Confirm the story's text replaces the old one outright, or whether the position should be kept.
- **Confirmed banner drops the employee's name**: the current message greets them by name; the new wording does not. Assumed replaced.
- **"[formatted date]"**: date only, or date and time? The card already shows date and time separately in an `en-SG` format. Assumed the card's existing date format, date only.
- **"Auto-dismiss after a few seconds"**: the criterion says dismissible "or" auto-dismiss. Is one enough, or both? What duration? Assumed both, about five seconds; a short auto-dismiss can be an accessibility problem for slow readers.
- **Session date format in the notification**: local or UTC, formatted or raw? Assumed an unambiguous UTC timestamp for the console entry, with a readable form for Slack.
- **Which Slack "channel"**: an incoming webhook is bound to one channel, so "the configured channel" is whatever the webhook points at. No per-employee direct message is implied; the employee's name and email would be posted into a shared channel.
- **Does the promoted employee get anything they can see?**: with console/Slack only, the employee is not actually told. Accepted by the card ("for training simplicity"), but worth stating that the story's user value for promotion is simulated.

### Edge Cases

- **Registration succeeds, notification fails**: must still return the normal success response. This is the core criterion and needs a deliberate failure in a test.
- **A channel throws synchronously vs rejects later**: both must be contained. An uncaught rejection in a not-awaited call can terminate the server process on current Node versions, turning a "silent" failure into an outage.
- **Slack is slow or hangs**: without a time limit, pending calls accumulate under load even though no response waits on them.
- **Slack answers with an error status**: not an exception, but still a failure that should be noted for operators without affecting the employee.
- **Webhook variable set but empty or malformed**: should behave as "Slack not configured", not as a failure on every registration.
- **Cancellation of a confirmed registration with an empty waitlist**: nobody is promoted, so no notification.
- **Cancellation of a waitlisted registration**: no promotion, so no notification.
- **Promotion skips a candidate because of a concurrent change**: the notification must describe the registration actually promoted, not the first candidate considered.
- **Two cancellations at once promoting two different people**: each promotion yields exactly one notification for the right person.
- **Employee names or session titles containing line breaks or markup**: must not be able to forge extra console entries or alter Slack formatting.
- **Server stops while a notification is in flight**: the notification is lost. Acceptable given no history or retry, but it should be a stated limitation.
- **Banner auto-dismisses while the employee is mid-read, or after the card has been removed from the page**: the timer must not act on a card that is gone, and a new action must replace an old banner cleanly.
- **Same employee registers twice**: duplicate prevention is out of scope elsewhere, so two notifications is correct behaviour.

### Technical Risks

- **Testing something that is deliberately not awaited**: a test that checks the console immediately after the response may run before the notification is written, giving flaky results. Mitigation direction: make dispatch observable in tests (for example by letting pending work settle) without making the production path wait.
- **Tests polluting or depending on console output**: integration suites share one process and one database file and run serially. Capturing console output must be scoped and restored per test so suites don't interfere.
- **Real network calls from tests or CI**: a developer with the webhook variable set locally could post test registrations into a real Slack channel. Mitigation direction: tests must replace the outbound call, and the variable should be absent in the test environment by default.
- **Personal data in logs and Slack**: name and email are written to the server console and, optionally, sent to a third party. This is what the card asks for, but it should be a conscious, documented choice. The automated security review flagged earlier stories and is likely to flag this.
- **The webhook address is a secret**: it must come from the environment only, never be logged, committed or echoed in error output; the example environment file should document the variable without a value.
- **Outbound request from the server**: the destination is operator-configured, not user-supplied, so the request-forgery risk is low, but it should stay that way (no user input in the address).
- **Blast radius on existing behaviour**: the registration and cancellation paths are covered by the WH-2 to WH-5 suites and include careful concurrency handling. The notification hook must sit after those transactions and leave their results and response shapes unchanged; the existing suites are the regression gate.
- **Existing WH-3 wording**: changing the waitlist message could break a WH-3 expectation if any automated check pins the old text. None was found (there are no frontend tests), so the risk is to manual acceptance of WH-3, not to the suite.
- **No new runtime dependency needed**: the runtime already provides an HTTP client, so Slack does not require adding a package. Adding one would be an avoidable supply-chain and review cost.

### Acceptance Criteria Coverage

| AC# | Description                                                                                           | Addressable? | Gaps/Notes                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Confirmed banner: "You're registered! [Session title] on [formatted date]"                            | Yes          | Replaces the current named greeting. Date format to confirm. Manual verification (no frontend tests).                                 |
| 2   | Waitlist banner: "You're on the waitlist for [Session title]. We'll let you know if a spot opens up." | Yes          | Drops the waitlist position shown since WH-3; confirm that is intended. Manual verification.                                          |
| 3   | Banners appear immediately after submit without a page reload                                         | Yes          | Already how the card behaves; keep it that way. Manual verification.                                                                  |
| 4   | Banners can be dismissed or auto-dismiss after a few seconds                                          | Yes          | New behaviour. "Or" vs both, and the duration, to confirm. Cancellation messages share the area. Manual verification.                 |
| 5   | Banner still appears if the backend notification fails                                                | Yes          | Follows from AC 11: the response is unaffected, so the banner is too. Proven on the API side by test; the UI part is by construction. |
| 6   | Notification emitted after a confirmed registration                                                   | Yes          | Not emitted for waitlisted registrations (assumed).                                                                                   |
| 7   | Notification emitted after a waitlist promotion                                                       | Yes          | Uses WH-5's hand-off; the promoted employee's details must be gathered, since only the id is exposed today.                           |
| 8   | Notification includes name, email, session title, session date, status (`confirmed` / `promoted`)     | Yes          | `promoted` is a notification kind, not a registration status. Date format to confirm.                                                 |
| 9   | Baseline: notification logged to the server console                                                   | Yes          | Structured single-line entry recommended. Personal data in logs is accepted by the card.                                              |
| 10  | Optional: Slack message when `SLACK_WEBHOOK_URL` is set                                               | Partial      | In or out of scope needs a decision. If in: secret handling, time limit, error statuses and a test that never reaches Slack.          |
| 11  | Notification failures must not fail the registration or promotion                                     | Yes          | Needs a forced-failure test, and care that a not-awaited failure cannot crash the process.                                            |
