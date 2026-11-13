import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

const TEST_EMAIL_PREFIX = 'test-wh5-registration-status-lookup-'

interface SessionSummary {
  id: number
  registered: number
  capacity: number
  waitlisted: number
}

const originalCounters = new Map<number, number>()

afterEach(async () => {
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

interface FullSessionFixture {
  sessionId: number
  confirmedId: number
  firstWaitlistedId: number
  secondWaitlistedId: number
}

async function register(sessionId: number, label: string, name: string, expected: number) {
  const res = await request(app)
    .post(`/api/training-sessions/${sessionId}/registrations`)
    .send({ name, email: `${TEST_EMAIL_PREFIX}${label}@example.com` })
  expect(res.status).toBe(expected)
  const id: number = res.body.id
  return id
}

async function setUpFullSession(): Promise<FullSessionFixture> {
  const response = await request(app).get('/api/training-sessions')
  const sessions: SessionSummary[] = response.body
  const session = sessions.find((s) => s.registered < s.capacity && s.waitlisted === 0)
  if (!session) throw new Error('No suitable session available for testing')
  originalCounters.set(session.id, session.registered)
  await prisma.trainingSession.update({
    where: { id: session.id },
    data: { registered: session.capacity - 1 },
  })

  const confirmedId = await register(session.id, 'confirmed', 'Test Confirmed', 201)
  const firstWaitlistedId = await register(
    session.id,
    'first-waitlisted',
    'Test First Waitlisted',
    202
  )
  const secondWaitlistedId = await register(
    session.id,
    'second-waitlisted',
    'Test Second Waitlisted',
    202
  )
  return { sessionId: session.id, confirmedId, firstWaitlistedId, secondWaitlistedId }
}

describe('GET /api/training-sessions/:id/registrations/:registrationId', () => {
  it('WH-5 Clarification 1: GET returns only the id and current status', async () => {
    const { sessionId, firstWaitlistedId } = await setUpFullSession()

    const res = await request(app).get(
      `/api/training-sessions/${sessionId}/registrations/${firstWaitlistedId}`
    )

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: firstWaitlistedId, status: 'waitlisted' })
  })

  it('WH-5 AC 2: a promoted registration reads as confirmed', async () => {
    const { sessionId, confirmedId, firstWaitlistedId } = await setUpFullSession()
    const cancelled = await request(app).delete(
      `/api/training-sessions/${sessionId}/registrations/${confirmedId}`
    )
    expect(cancelled.status).toBe(200)

    const res = await request(app).get(
      `/api/training-sessions/${sessionId}/registrations/${firstWaitlistedId}`
    )

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('confirmed')
  })

  it('WH-5 Clarification 1: unknown, other-session and malformed ids return 404', async () => {
    const { sessionId, firstWaitlistedId } = await setUpFullSession()
    const response = await request(app).get('/api/training-sessions')
    const sessions: SessionSummary[] = response.body
    const otherSession = sessions.find((s) => s.id !== sessionId)
    if (!otherSession) throw new Error('No other session available for testing')

    const paths = [
      `/api/training-sessions/${sessionId}/registrations/999999999`,
      `/api/training-sessions/${otherSession.id}/registrations/${firstWaitlistedId}`,
      `/api/training-sessions/${sessionId}/registrations/abc`,
    ]
    for (const path of paths) {
      const res = await request(app).get(path)
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Registration not found' })
    }
  })
})
