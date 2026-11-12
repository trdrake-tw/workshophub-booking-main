import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

const TEST_EMAIL_PREFIX = 'test-wh4-already-cancelled-409-'

interface SessionSummary {
  id: number
  registered: number
  capacity: number
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

async function getNonFullSession(): Promise<SessionSummary> {
  const response = await request(app).get('/api/training-sessions')
  const sessions: SessionSummary[] = response.body
  const session = sessions.find((s) => s.registered < s.capacity)
  if (!session) throw new Error('No non-full session available for testing')
  originalCounters.set(session.id, session.registered)
  return session
}

async function getRegistered(sessionId: number): Promise<number> {
  const res = await request(app).get(`/api/training-sessions/${sessionId}`)
  expect(res.status).toBe(200)
  return res.body.registered
}

describe('DELETE /api/training-sessions/:id/registrations/:registrationId', () => {
  it('WH-4 AC 10: a second cancel returns 409 and registered drops by exactly 1 overall', async () => {
    const session = await getNonFullSession()
    const created = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: 'Test Canceller', email: `${TEST_EMAIL_PREFIX}a@example.com` })
    expect(created.status).toBe(201)
    const registrationId: number = created.body.id
    const afterRegistering = await getRegistered(session.id)
    const path = `/api/training-sessions/${session.id}/registrations/${registrationId}`

    const first = await request(app).delete(path)
    const second = await request(app).delete(path)

    expect(first.status).toBe(200)
    expect(second.status).toBe(409)
    expect(typeof second.body.error).toBe('string')
    expect(await getRegistered(session.id)).toBe(afterRegistering - 1)
  })
})
