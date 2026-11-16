import { getAuditHistory, recordTransition } from '../../src/services/auditLogService'
import prisma from '../../src/lib/prisma'

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    registration: {
      findFirst: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  },
}))

const mockRegistrationFindFirst = prisma.registration.findFirst as jest.Mock
const mockAuditLogFindMany = prisma.auditLog.findMany as jest.Mock
const mockDefaultAuditLogCreate = prisma.auditLog.create as jest.Mock

type TransactionClient = Parameters<typeof recordTransition>[0]

function buildTx(create: jest.Mock): TransactionClient {
  return { auditLog: { create } } as unknown as TransactionClient
}

afterEach(() => {
  jest.clearAllMocks()
})

describe('getAuditHistory', () => {
  it('getAuditHistory returns null without reading entries when the registration is not found', async () => {
    mockRegistrationFindFirst.mockResolvedValue(null)

    const result = await getAuditHistory(1, 999)

    expect(result).toBeNull()
    expect(mockAuditLogFindMany).not.toHaveBeenCalled()
  })

  it('getAuditHistory scopes the registration by session', async () => {
    mockRegistrationFindFirst.mockResolvedValue({ id: 5 })
    mockAuditLogFindMany.mockResolvedValue([])

    await getAuditHistory(1, 5)

    expect(mockRegistrationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5, sessionId: 1 } })
    )
  })

  it('getAuditHistory reads entries oldest first with id as tie-break', async () => {
    const changedAt = new Date('2026-11-16T10:00:00Z')
    const rows = [
      {
        id: 10,
        registrationId: 5,
        fromStatus: null,
        toStatus: 'confirmed',
        changedAt,
        reason: 'registered',
      },
      {
        id: 11,
        registrationId: 5,
        fromStatus: 'confirmed',
        toStatus: 'cancelled',
        changedAt,
        reason: 'cancelled',
      },
    ]
    mockRegistrationFindFirst.mockResolvedValue({ id: 5 })
    mockAuditLogFindMany.mockResolvedValue(rows)

    const result = await getAuditHistory(1, 5)

    expect(mockAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { registrationId: 5 },
        orderBy: [{ changedAt: 'asc' }, { id: 'asc' }],
      })
    )
    expect(result).toEqual(rows)
  })
})

describe('recordTransition', () => {
  it('recordTransition creates one entry through the given transaction client', async () => {
    const txCreate = jest.fn().mockResolvedValue({ id: 1 })

    await recordTransition(buildTx(txCreate), {
      registrationId: 7,
      fromStatus: null,
      toStatus: 'confirmed',
      reason: 'registered',
    })

    expect(txCreate).toHaveBeenCalledTimes(1)
    expect(txCreate).toHaveBeenCalledWith({
      data: { registrationId: 7, fromStatus: null, toStatus: 'confirmed', reason: 'registered' },
    })
    expect(mockDefaultAuditLogCreate).not.toHaveBeenCalled()
  })

  it('recordTransition lets a write failure propagate', async () => {
    const failure = new Error('audit write failed')
    const txCreate = jest.fn().mockRejectedValue(failure)

    await expect(
      recordTransition(buildTx(txCreate), {
        registrationId: 7,
        fromStatus: null,
        toStatus: 'confirmed',
        reason: 'registered',
      })
    ).rejects.toBe(failure)
  })
})
