import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

const TEST_EMAIL_PREFIX = 'test-wh5-no-waitlist-no-promotion-'

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

async function getRegistered(sessionId: number): Promise<number> {
  const res = await request(app).get(`/api/training-sessions/${sessionId}`)
  expect(res.status).toBe(200)
  return res.body.registered
}

describe('Cancelling with an empty waitlist', () => {
  it('WH-5 AC 6: with nobody waitlisted, registered decrements and nobody is promoted', async () => {
    const response = await request(app).get('/api/training-sessions')
    const sessions: SessionSummary[] = response.body
    const session = sessions.find((s) => s.registered < s.capacity && s.waitlisted === 0)
    if (!session) throw new Error('No suitable session available for testing')
    originalCounters.set(session.id, session.registered)

    const created = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: 'Test Confirmed', email: `${TEST_EMAIL_PREFIX}confirmed@example.com` })
    expect(created.status).toBe(201)
    const registrationId: number = created.body.id
    const afterRegistering = await getRegistered(session.id)

    const res = await request(app).delete(
      `/api/training-sessions/${session.id}/registrations/${registrationId}`
    )

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'cancelled', promotedRegistrationId: null })
    expect(await getRegistered(session.id)).toBe(afterRegistering - 1)
  })
})
