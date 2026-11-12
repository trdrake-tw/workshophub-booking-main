import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

const TEST_EMAIL_PREFIX = 'test-wh4-not-found-404-'

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

async function getSessions(): Promise<SessionSummary[]> {
  const response = await request(app).get('/api/training-sessions')
  return response.body
}

async function getNonFullSession(): Promise<SessionSummary> {
  const session = (await getSessions()).find((s) => s.registered < s.capacity)
  if (!session) throw new Error('No non-full session available for testing')
  originalCounters.set(session.id, session.registered)
  return session
}

describe('DELETE /api/training-sessions/:id/registrations/:registrationId', () => {
  it('WH-4 AC 9: returns 404 for an unknown registration id', async () => {
    const session = await getNonFullSession()

    const res = await request(app).delete(
      `/api/training-sessions/${session.id}/registrations/999999`
    )

    expect(res.status).toBe(404)
    expect(typeof res.body.error).toBe('string')
  })

  it('WH-4 AC 9: returns 404 for a real registration id used under a different session', async () => {
    const session = await getNonFullSession()
    const other = (await getSessions()).find((s) => s.id !== session.id)
    if (!other) throw new Error('Need a second session for testing')
    const created = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: 'Test Canceller', email: `${TEST_EMAIL_PREFIX}other@example.com` })
    expect(created.status).toBe(201)
    const registrationId: number = created.body.id

    const res = await request(app).delete(
      `/api/training-sessions/${other.id}/registrations/${registrationId}`
    )

    expect(res.status).toBe(404)
    expect(typeof res.body.error).toBe('string')
    const row = await prisma.registration.findUnique({ where: { id: registrationId } })
    expect(row?.status).toBe('confirmed')
  })

  it('WH-4 AC 9: returns 404 for a non-numeric registration id', async () => {
    const session = await getNonFullSession()

    const res = await request(app).delete(`/api/training-sessions/${session.id}/registrations/abc`)

    expect(res.status).toBe(404)
    expect(typeof res.body.error).toBe('string')
  })

  it('WH-4 AC 9: returns 404 for a non-numeric session id', async () => {
    const res = await request(app).delete('/api/training-sessions/abc/registrations/1')

    expect(res.status).toBe(404)
    expect(typeof res.body.error).toBe('string')
  })
})
