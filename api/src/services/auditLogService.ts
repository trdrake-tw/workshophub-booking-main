import type { Prisma } from '@prisma/client'
import prisma from '../lib/prisma'

export const AUDIT_REASON = {
  registered: 'registered',
  waitlisted: 'waitlisted',
  promoted: 'promoted',
  cancelled: 'cancelled',
} as const

export type AuditReason = (typeof AUDIT_REASON)[keyof typeof AUDIT_REASON]

export type TransitionInput = {
  registrationId: number
  fromStatus: string | null
  toStatus: string
  reason: AuditReason
}

export type AuditLogEntryView = {
  id: number
  registrationId: number
  fromStatus: string | null
  toStatus: string
  changedAt: Date
  reason: string | null
}

// Oldest first; id breaks ties between entries written in the same millisecond.
const HISTORY_ORDER = [
  { changedAt: 'asc' },
  { id: 'asc' },
] as const satisfies Prisma.AuditLogOrderByWithRelationInput[]

// Takes the caller's transaction: the entry commits or rolls back with the state change it describes.
export async function recordTransition(
  tx: Prisma.TransactionClient,
  transition: TransitionInput
): Promise<void> {
  await tx.auditLog.create({
    data: {
      registrationId: transition.registrationId,
      fromStatus: transition.fromStatus,
      toStatus: transition.toStatus,
      reason: transition.reason,
    },
  })
}

// Null when the registration does not exist under this session.
export async function getAuditHistory(
  sessionId: number,
  registrationId: number
): Promise<AuditLogEntryView[] | null> {
  const registration = await prisma.registration.findFirst({
    where: { id: registrationId, sessionId },
    select: { id: true },
  })
  if (!registration) return null

  return prisma.auditLog.findMany({
    where: { registrationId },
    orderBy: HISTORY_ORDER,
    select: {
      id: true,
      registrationId: true,
      fromStatus: true,
      toStatus: true,
      changedAt: true,
      reason: true,
    },
  })
}
