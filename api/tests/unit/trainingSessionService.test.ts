import {
  getAllSessions,
  getSessionById,
  createRegistration,
  cancelRegistration,
  getRegistrationStatus,
} from '../../src/services/trainingSessionService'
import prisma from '../../src/lib/prisma'

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    trainingSession: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    registration: {
      create: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}))

const mockFindMany = prisma.trainingSession.findMany as jest.Mock
const mockFindUnique = prisma.trainingSession.findUnique as jest.Mock
const mockUpdateMany = prisma.trainingSession.updateMany as jest.Mock
const mockRegistrationCreate = prisma.registration.create as jest.Mock
const mockRegistrationCount = prisma.registration.count as jest.Mock
const mockRegistrationFindFirst = prisma.registration.findFirst as jest.Mock
const mockRegistrationUpdateMany = prisma.registration.updateMany as jest.Mock
const mockTransaction = prisma.$transaction as jest.Mock

const mockSession = {
  id: 1,
  title: 'TDD in Agentic Development Loop',
  description: 'Learn test-driven development with AI assistance.',
  date: new Date('2026-07-01T09:00:00Z'),
  capacity: 20,
  registered: 5,
  location: 'Room A',
  deliveryMode: 'In-person',
  status: 'open',
}

const mockRegistration = {
  id: 1,
  sessionId: 1,
  name: 'Test Attendee',
  email: 'test@example.com',
  status: 'confirmed',
  createdAt: new Date().toISOString(),
}

afterEach(() => {
  jest.clearAllMocks()
})

describe('getAllSessions', () => {
  it('returns sessions ordered by date', async () => {
    const second = { ...mockSession, id: 2, date: new Date('2026-07-02T09:00:00Z') }
    mockFindMany.mockResolvedValue([
      { ...mockSession, _count: { registrations: 0 } },
      { ...second, _count: { registrations: 3 } },
    ])

    const result = await getAllSessions()

    expect(result).toEqual([
      { ...mockSession, waitlisted: 0 },
      { ...second, waitlisted: 3 },
    ])
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { date: 'asc' } }))
  })

  it('returns an empty array when no sessions exist', async () => {
    mockFindMany.mockResolvedValue([])

    const result = await getAllSessions()

    expect(result).toEqual([])
  })
})

describe('getSessionById', () => {
  it('returns the matching session', async () => {
    mockFindUnique.mockResolvedValue({ ...mockSession, _count: { registrations: 2 } })

    const result = await getSessionById(1)

    expect(result).toEqual({ ...mockSession, waitlisted: 2 })
    expect(mockFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }))
  })

  it('returns null when session does not exist', async () => {
    mockFindUnique.mockResolvedValue(null)

    const result = await getSessionById(999)

    expect(result).toBeNull()
  })
})

describe('createRegistration', () => {
  it('creates a registration for a valid session with enough capacity', async () => {
    mockFindUnique.mockResolvedValue(mockSession)
    mockUpdateMany.mockResolvedValue({ count: 1 })
    mockRegistrationCreate.mockResolvedValue(mockRegistration)
    mockTransaction.mockImplementation((fn) =>
      fn({
        trainingSession: {
          updateMany: mockUpdateMany,
        },
        registration: {
          create: mockRegistrationCreate,
        },
      })
    )

    const result = await createRegistration(1, 'Test Attendee', 'test@example.com')

    expect(result).toEqual({ status: 'confirmed', registration: mockRegistration })
    expect(mockRegistrationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'confirmed' }),
    })
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: 1 } })
    expect(mockTransaction).toHaveBeenCalled()
  })

  it('throws 400 error when name is empty', async () => {
    try {
      await createRegistration(1, '', 'test@example.com')
    } catch (error) {
      const err = error as { status: number; error: string }
      expect(err.status).toBe(400)
      expect(err.error).toBe('Name and email are required')
    }
  })

  it('throws 400 error when email is empty', async () => {
    try {
      await createRegistration(1, 'Test Attendee', '')
    } catch (error) {
      const err = error as { status: number; error: string }
      expect(err.status).toBe(400)
      expect(err.error).toBe('Name and email are required')
    }
  })

  it('throws 400 error when email format is invalid', async () => {
    try {
      await createRegistration(1, 'Test Attendee', 'invalid-email')
    } catch (error) {
      const err = error as { status: number; error: string }
      expect(err.status).toBe(400)
      expect(err.error).toBe('Invalid email format')
    }
  })

  it('throws 404 error when session does not exist', async () => {
    mockFindUnique.mockResolvedValue(null)

    try {
      await createRegistration(1, 'Test Attendee', 'test@example.com')
    } catch (error) {
      const err = error as { status: number; error: string }
      expect(err.status).toBe(404)
      expect(err.error).toBe('Training session not found')
    }
  })

  it('waitlists the registration with its position when the session is full', async () => {
    const waitlisted = { ...mockRegistration, id: 7, status: 'waitlisted' }
    mockFindUnique.mockResolvedValue(mockSession)
    mockUpdateMany.mockResolvedValue({ count: 0 })
    mockRegistrationCreate.mockResolvedValue(waitlisted)
    mockRegistrationCount.mockResolvedValue(2)
    mockTransaction.mockImplementation((fn) =>
      fn({
        trainingSession: { updateMany: mockUpdateMany },
        registration: { create: mockRegistrationCreate, count: mockRegistrationCount },
      })
    )

    const result = await createRegistration(1, 'Test Attendee', 'test@example.com')

    expect(result).toEqual({ status: 'waitlisted', registration: waitlisted, position: 2 })
    expect(mockRegistrationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'waitlisted' }),
    })
  })
})

describe('cancelRegistration', () => {
  function useTransaction() {
    mockTransaction.mockImplementation((fn) =>
      fn({
        trainingSession: { updateMany: mockUpdateMany },
        registration: {
          findFirst: mockRegistrationFindFirst,
          updateMany: mockRegistrationUpdateMany,
        },
      })
    )
  }

  it('cancels a confirmed registration and decrements the session counter', async () => {
    mockRegistrationFindFirst
      .mockResolvedValueOnce({ status: 'confirmed' })
      .mockResolvedValueOnce(null)
    mockRegistrationUpdateMany.mockResolvedValue({ count: 1 })
    mockUpdateMany.mockResolvedValue({ count: 1 })
    useTransaction()

    const result = await cancelRegistration(1, 5)

    expect(result).toEqual({
      status: 'cancelled',
      registrationId: 5,
      previousStatus: 'confirmed',
      promotedRegistrationId: null,
    })
    expect(mockRegistrationUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 5, sessionId: 1, status: 'confirmed' }),
      data: { status: 'cancelled' },
    })
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 1, registered: { gt: 0 } },
      data: { registered: { decrement: 1 } },
    })
  })

  it('promotes the first waitlisted registration and leaves the counter alone', async () => {
    mockRegistrationFindFirst
      .mockResolvedValueOnce({ status: 'confirmed' })
      .mockResolvedValueOnce({ id: 7 })
    mockRegistrationUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
    useTransaction()

    const result = await cancelRegistration(1, 5)

    expect(result.promotedRegistrationId).toBe(7)
    expect(mockUpdateMany).not.toHaveBeenCalled()
    expect(mockRegistrationFindFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { sessionId: 1, status: 'waitlisted' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    )
    expect(mockRegistrationUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 7, sessionId: 1, status: 'waitlisted' },
      data: { status: 'confirmed' },
    })
  })

  it('tries the next candidate when the first was changed concurrently', async () => {
    mockRegistrationFindFirst
      .mockResolvedValueOnce({ status: 'confirmed' })
      .mockResolvedValueOnce({ id: 7 })
      .mockResolvedValueOnce({ id: 8 })
    mockRegistrationUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
    useTransaction()

    const result = await cancelRegistration(1, 5)

    expect(result.promotedRegistrationId).toBe(8)
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('decrements when every promotion attempt loses its race', async () => {
    mockRegistrationFindFirst
      .mockResolvedValueOnce({ status: 'confirmed' })
      .mockResolvedValueOnce({ id: 7 })
      .mockResolvedValueOnce({ id: 8 })
      .mockResolvedValueOnce({ id: 9 })
    mockRegistrationUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
    mockUpdateMany.mockResolvedValue({ count: 1 })
    useTransaction()

    const result = await cancelRegistration(1, 5)

    expect(result.promotedRegistrationId).toBeNull()
    expect(mockUpdateMany).toHaveBeenCalledTimes(1)
  })

  it('does not look for a candidate when a waitlisted registration is cancelled', async () => {
    mockRegistrationFindFirst.mockResolvedValueOnce({ status: 'waitlisted' })
    mockRegistrationUpdateMany.mockResolvedValueOnce({ count: 1 })
    useTransaction()

    const result = await cancelRegistration(1, 6)

    expect(mockRegistrationFindFirst).toHaveBeenCalledTimes(1)
    expect(result.promotedRegistrationId).toBeNull()
  })

  it('propagates a failure inside promotion so the cancellation rolls back', async () => {
    mockRegistrationFindFirst
      .mockResolvedValueOnce({ status: 'confirmed' })
      .mockResolvedValueOnce({ id: 7 })
    mockRegistrationUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('boom'))
    useTransaction()

    await expect(cancelRegistration(1, 5)).rejects.toThrow('boom')
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('cancels a waitlisted registration without touching the session counter', async () => {
    mockRegistrationFindFirst.mockResolvedValue({ status: 'waitlisted' })
    mockRegistrationUpdateMany.mockResolvedValue({ count: 1 })
    useTransaction()

    const result = await cancelRegistration(1, 6)

    expect(result).toEqual({
      status: 'cancelled',
      registrationId: 6,
      previousStatus: 'waitlisted',
      promotedRegistrationId: null,
    })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('throws 404 when the registration does not exist in that session', async () => {
    mockRegistrationFindFirst.mockResolvedValue(null)
    useTransaction()

    await expect(cancelRegistration(1, 999)).rejects.toEqual({
      status: 404,
      error: 'Registration not found',
    })
  })

  it('throws 409 when the registration is already cancelled', async () => {
    mockRegistrationFindFirst.mockResolvedValue({ status: 'cancelled' })
    useTransaction()

    await expect(cancelRegistration(1, 5)).rejects.toEqual({
      status: 409,
      error: 'Registration is already cancelled',
    })
    expect(mockRegistrationUpdateMany).not.toHaveBeenCalled()
  })

  it('throws 409 and leaves the counter alone when another request cancelled it first', async () => {
    mockRegistrationFindFirst.mockResolvedValue({ status: 'confirmed' })
    mockRegistrationUpdateMany.mockResolvedValue({ count: 0 })
    useTransaction()

    await expect(cancelRegistration(1, 5)).rejects.toEqual({
      status: 409,
      error: 'Registration is already cancelled',
    })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })
})

describe('getRegistrationStatus', () => {
  it('returns the id and status of a registration in that session', async () => {
    mockRegistrationFindFirst.mockResolvedValue({ id: 7, status: 'confirmed' })

    const result = await getRegistrationStatus(1, 7)

    expect(result).toEqual({ id: 7, status: 'confirmed' })
    expect(mockRegistrationFindFirst).toHaveBeenCalledWith({
      where: { id: 7, sessionId: 1 },
      select: { id: true, status: true },
    })
  })

  it('returns null when the registration is not found', async () => {
    mockRegistrationFindFirst.mockResolvedValue(null)

    const result = await getRegistrationStatus(1, 999)

    expect(result).toBeNull()
  })
})
