export type NotificationStatus = 'confirmed' | 'promoted'

export type RegistrationNotification = {
  status: NotificationStatus
  name: string
  email: string
  sessionTitle: string
  sessionDate: Date
}

export type NotificationChannel = (notification: RegistrationNotification) => void | Promise<void>

// Either a ready notification or a builder that resolves to one (null means nothing to send).
export type NotificationSource =
  | RegistrationNotification
  | (() => Promise<RegistrationNotification | null>)

const LOG_MARKER = '[notification]'

// One JSON-encoded line, so user-supplied text cannot inject line breaks or forge entries.
const consoleChannel: NotificationChannel = (notification) => {
  const { status, name, email, sessionTitle } = notification
  console.log(
    `${LOG_MARKER} ${JSON.stringify({
      status,
      name,
      email,
      sessionTitle,
      sessionDate: notification.sessionDate.toISOString(),
    })}`
  )
}

const channels: NotificationChannel[] = [consoleChannel]

function reportFailure(error: unknown): void {
  try {
    console.error(
      `${LOG_MARKER} delivery failed:`,
      error instanceof Error ? error.message : 'unknown error'
    )
  } catch {
    // Reporting must never throw.
  }
}

async function deliver(notification: RegistrationNotification): Promise<void> {
  // Promise.resolve().then turns a synchronous throw into a rejection, so each channel is isolated.
  await Promise.all(
    channels.map((channel) =>
      Promise.resolve()
        .then(() => channel(notification))
        .catch(reportFailure)
    )
  )
}

const pending = new Set<Promise<void>>()

// Fire-and-forget: callers must not await this, and a failure here never reaches them.
export function dispatchNotification(source: NotificationSource): void {
  const work: Promise<void> = Promise.resolve()
    .then(() => (typeof source === 'function' ? source() : source))
    .then((notification) => (notification ? deliver(notification) : undefined))
    .catch(reportFailure)

  pending.add(work)
  void work.then(() => pending.delete(work))
}

// For tests and shutdown: resolves once every in-flight notification has finished.
export async function settleNotifications(): Promise<void> {
  while (pending.size > 0) {
    await Promise.all([...pending])
  }
}
