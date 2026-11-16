import { getAuditHistory } from '../../src/services/auditLogService'
import prisma from '../../src/lib/prisma'

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    registration: {
      findFirst: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn(),
    },
  },
}))

const mockRegistrationFindFirst = prisma.registration.findFirst as jest.Mock
const mockAuditLogFindMany = prisma.auditLog.findMany as jest.Mock

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
