import type { Prisma } from '@prisma/client'
import prisma from '../lib/prisma'

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
