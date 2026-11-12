import type { MyRegistration, RegistrationStatus, TrainingSession } from '../types'

const STORAGE_KEY = 'workshophub.myRegistrations.v1'

function isRegistrationStatus(value: unknown): value is RegistrationStatus {
  return value === 'confirmed' || value === 'waitlisted' || value === 'cancelled'
}

function isMyRegistration(value: unknown): value is MyRegistration {
  if (typeof value !== 'object' || value === null) return false
  return (
    'registrationId' in value &&
    typeof value.registrationId === 'number' &&
    'status' in value &&
    isRegistrationStatus(value.status) &&
    'sessionCreatedAt' in value &&
    typeof value.sessionCreatedAt === 'string'
  )
}

function readAll(): Record<string, MyRegistration> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const all: Record<string, MyRegistration> = {}
    for (const [sessionId, entry] of Object.entries(parsed)) {
      if (isMyRegistration(entry)) all[sessionId] = entry
    }
    return all
  } catch {
    return {}
  }
}

function writeAll(all: Record<string, MyRegistration>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // Storage unavailable (private mode, quota): the page still works without it.
  }
}

export function getMyRegistration(session: TrainingSession): MyRegistration | null {
  const all = readAll()
  const entry = all[String(session.id)]
  if (!entry) return null
  // Reseed guard: a reseeded database recreates sessions with a new createdAt,
  // so an id saved against the old database must not be used to cancel.
  if (entry.sessionCreatedAt !== session.createdAt) {
    delete all[String(session.id)]
    writeAll(all)
    return null
  }
  return entry
}

export function saveMyRegistration(
  session: TrainingSession,
  registrationId: number,
  status: RegistrationStatus
): void {
  const all = readAll()
  all[String(session.id)] = { registrationId, status, sessionCreatedAt: session.createdAt }
  writeAll(all)
}

export function markMyRegistrationCancelled(sessionId: number): void {
  const all = readAll()
  const entry = all[String(sessionId)]
  if (!entry) return
  all[String(sessionId)] = { ...entry, status: 'cancelled' }
  writeAll(all)
}

export function forgetMyRegistration(sessionId: number): void {
  const all = readAll()
  if (!(String(sessionId) in all)) return
  delete all[String(sessionId)]
  writeAll(all)
}
