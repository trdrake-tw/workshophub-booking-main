import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'
import { settleNotifications } from '../../src/services/notificationService'

const TEST_EMAIL_PREFIX = 'test-wh8-confirmed-notification-'
const NOTIFICATION_MARKER = '[notification] '

interface SessionSummary {
  id: number
  registered: number
  capacity: number
  waitlisted: number
}

interface NotificationEntry {
  email: string
}

const originalCounters = new Map<number, number>()

let logSpy: jest.SpyInstance
let errorSpy: jest.SpyInstance

beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(async () => {
  logSpy.mockRestore()
  errorSpy.mockRestore()
  await prisma.registration.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  })
  for (const [id, registered] of originalCounters) {
    await prisma.trainingSession.update({ where: { id }, data: { registered } })
  }
  originalCounters.clear()
})

afterAll(async () => {
  await prisma.$disconnect()
})

function isNotificationEntry(value: unknown): value is NotificationEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { email?: unknown }).email === 'string'
  )
}

function notificationEntries(spy: jest.SpyInstance): NotificationEntry[] {
  const entries: NotificationEntry[] = []
  for (const call of spy.mock.calls) {
    const first: unknown = call[0]
    if (typeof first !== 'string' || !first.startsWith(NOTIFICATION_MARKER)) continue
    const parsed: unknown = JSON.parse(first.slice(NOTIFICATION_MARKER.length))
    if (isNotificationEntry(parsed)) entries.push(parsed)
  }
  return entries
}

async function getNonFullSession(): Promise<SessionSummary> {
  const response = await request(app).get('/api/training-sessions')
  const sessions: SessionSummary[] = response.body
  const session = sessions.find((s) => s.registered < s.capacity)
  if (!session) throw new Error('No non-full session available for testing')
  return session
}

describe('POST /api/training-sessions/:id/registrations', () => {
  it('WH-8 AC 6: a confirmed registration logs one notification', async () => {
    const session = await getNonFullSession()
    originalCounters.set(session.id, session.registered)
    const email = `${TEST_EMAIL_PREFIX}confirmed@example.com`

    const res = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: 'Test Confirmed', email })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ sessionId: session.id, email, status: 'confirmed' })

    await settleNotifications()

    const mine = notificationEntries(logSpy).filter((entry) =>
      entry.email.startsWith(TEST_EMAIL_PREFIX)
    )
    expect(mine).toHaveLength(1)
    expect(mine[0].email).toBe(email)
  })
})
