import type { Prisma, Registration, TrainingSession } from '@prisma/client'
import prisma from '../lib/prisma'

export const REGISTRATION_STATUS = {
  confirmed: 'confirmed',
  waitlisted: 'waitlisted',
  cancelled: 'cancelled',
} as const

// Waitlist order: earliest createdAt first, id breaks ties. WH-3's position count uses the same order.
const WAITLIST_ORDER = [
  { createdAt: 'asc' },
  { id: 'asc' },
] as const satisfies Prisma.RegistrationOrderByWithRelationInput[]

const MAX_PROMOTION_ATTEMPTS = 3

// `registered` is the confirmed-only counter; `waitlisted` is derived from registrations.
export type SessionWithCounts = TrainingSession & { waitlisted: number }

export type RegistrationResult =
  | { status: 'confirmed'; registration: Registration }
  | { status: 'waitlisted'; registration: Registration; position: number }

export type CancelRegistrationResult = {
  status: 'cancelled'
  registrationId: number
  previousStatus: 'confirmed' | 'waitlisted'
  promotedRegistrationId: number | null
}

export type RegistrationStatusView = { id: number; status: string }

const waitlistedCount = {
  _count: {
    select: { registrations: { where: { status: REGISTRATION_STATUS.waitlisted } } },
  },
} as const

function withWaitlisted(
  row: TrainingSession & { _count: { registrations: number } }
): SessionWithCounts {
  const { _count, ...session } = row
  return { ...session, waitlisted: _count.registrations }
}

export async function getAllSessions(): Promise<SessionWithCounts[]> {
  const rows = await prisma.trainingSession.findMany({
    orderBy: { date: 'asc' },
    include: waitlistedCount,
  })
  return rows.map(withWaitlisted)
}

export async function getSessionById(id: number): Promise<SessionWithCounts | null> {
  const row = await prisma.trainingSession.findUnique({
    where: { id },
    include: waitlistedCount,
  })
  return row ? withWaitlisted(row) : null
}

export async function createRegistration(
  sessionId: number,
  name: string,
  email: string
): Promise<RegistrationResult> {
  // Validate before any DB access so a rejected request never touches state.
  const trimmedName = typeof name === 'string' ? name.trim() : ''
  const trimmedEmail = typeof email === 'string' ? email.trim() : ''

  if (trimmedName === '' || trimmedEmail === '') {
    throw { status: 400, error: 'Name and email are required' }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    throw { status: 400, error: 'Invalid email format' }
  }

  // Existence pre-check: a missing session must be 404.
  const session = await prisma.trainingSession.findUnique({ where: { id: sessionId } })
  if (!session) {
    throw { status: 404, error: 'Training session not found' }
  }

  // The conditional update is the capacity decision: if it claims a seat the
  // registration is confirmed, otherwise the session is full and the employee
  // joins the waitlist. The counter can never exceed capacity.
  return prisma.$transaction(async (tx): Promise<RegistrationResult> => {
    const updated = await tx.trainingSession.updateMany({
      where: { id: sessionId, registered: { lt: session.capacity } },
      data: { registered: { increment: 1 } },
    })

    if (updated.count > 0) {
      const registration = await tx.registration.create({
        data: {
          sessionId,
          name: trimmedName,
          email: trimmedEmail,
          status: REGISTRATION_STATUS.confirmed,
        },
      })
      return { status: 'confirmed', registration }
    }

    const registration = await tx.registration.create({
      data: {
        sessionId,
        name: trimmedName,
        email: trimmedEmail,
        status: REGISTRATION_STATUS.waitlisted,
      },
    })

    // 1-based position among this session's waitlist, ordered by createdAt
    // (id breaks ties between rows created in the same millisecond).
    const position = await tx.registration.count({
      where: {
        sessionId,
        status: REGISTRATION_STATUS.waitlisted,
        OR: [
          { createdAt: { lt: registration.createdAt } },
          { createdAt: registration.createdAt, id: { lte: registration.id } },
        ],
      },
    })

    return { status: 'waitlisted', registration, position }
  })
}

// Hands the freed seat to the first waitlisted registration in the same transaction. Returns its id, or null if nobody could be promoted.
async function promoteFromWaitlist(
  tx: Prisma.TransactionClient,
  sessionId: number
): Promise<number | null> {
  for (let attempt = 0; attempt < MAX_PROMOTION_ATTEMPTS; attempt++) {
    const candidate = await tx.registration.findFirst({
      where: { sessionId, status: REGISTRATION_STATUS.waitlisted },
      orderBy: WAITLIST_ORDER,
      select: { id: true },
    })
    if (!candidate) return null

    const promoted = await tx.registration.updateMany({
      where: { id: candidate.id, sessionId, status: REGISTRATION_STATUS.waitlisted },
      data: { status: REGISTRATION_STATUS.confirmed },
    })
    if (promoted.count > 0) return candidate.id
    // No match: the candidate changed concurrently, so try the next one.
  }
  return null
}

export async function cancelRegistration(
  sessionId: number,
  registrationId: number
): Promise<CancelRegistrationResult> {
  return prisma.$transaction(async (tx): Promise<CancelRegistrationResult> => {
    const existing = await tx.registration.findFirst({
      where: { id: registrationId, sessionId },
      select: { status: true },
    })
    if (!existing) {
      throw { status: 404, error: 'Registration not found' }
    }
    if (existing.status === REGISTRATION_STATUS.cancelled) {
      throw { status: 409, error: 'Registration is already cancelled' }
    }
    if (
      existing.status !== REGISTRATION_STATUS.confirmed &&
      existing.status !== REGISTRATION_STATUS.waitlisted
    ) {
      throw { status: 409, error: 'Registration cannot be cancelled' }
    }
    const previousStatus = existing.status

    // Conditional on the status just read: if a concurrent cancel got there
    // first, no row matches and this request becomes the 409.
    const flipped = await tx.registration.updateMany({
      where: { id: registrationId, sessionId, status: previousStatus },
      data: { status: REGISTRATION_STATUS.cancelled },
    })
    if (flipped.count === 0) {
      throw { status: 409, error: 'Registration is already cancelled' }
    }

    let promotedRegistrationId: number | null = null
    if (previousStatus === REGISTRATION_STATUS.confirmed) {
      promotedRegistrationId = await promoteFromWaitlist(tx, sessionId)
      // A promotion transfers the seat, so registered only changes when nobody was promoted.
      if (promotedRegistrationId === null) {
        // The registered > 0 guard keeps drifted data from going negative.
        await tx.trainingSession.updateMany({
          where: { id: sessionId, registered: { gt: 0 } },
          data: { registered: { decrement: 1 } },
        })
      }
    }

    return { status: 'cancelled', registrationId, previousStatus, promotedRegistrationId }
  })
}

export async function getRegistrationStatus(
  sessionId: number,
  registrationId: number
): Promise<RegistrationStatusView | null> {
  return prisma.registration.findFirst({
    where: { id: registrationId, sessionId },
    select: { id: true, status: true },
  })
}
