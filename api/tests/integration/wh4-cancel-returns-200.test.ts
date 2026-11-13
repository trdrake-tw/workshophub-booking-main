import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

const TEST_EMAIL_PREFIX = 'test-wh4-cancel-returns-200-'

interface SessionSummary {
  id: number
  registered: number
  capacity: number
}

// Every session this file touches, with its counter before the test, so
// afterEach can restore it even when an assertion fails.
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

async function getNonFullSession(): Promise<SessionSummary> {
  const response = await request(app).get('/api/training-sessions')
  const sessions: SessionSummary[] = response.body
  const session = sessions.find((s) => s.registered < s.capacity)
  if (!session) throw new Error('No non-full session available for testing')
  originalCounters.set(session.id, session.registered)
  return session
}

describe('DELETE /api/training-sessions/:id/registrations/:registrationId', () => {
  it('WH-4 AC 6: returns 200 with { status: "cancelled" } for a confirmed registration', async () => {
    const session = await getNonFullSession()
    const created = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: 'Test Canceller', email: `${TEST_EMAIL_PREFIX}a@example.com` })
    expect(created.status).toBe(201)
    const registrationId: number = created.body.id

    const res = await request(app).delete(
      `/api/training-sessions/${session.id}/registrations/${registrationId}`
    )

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'cancelled', promotedRegistrationId: null })
  })
})
