import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

const TEST_EMAIL_PREFIX = 'test-wh4-registered-decrements-'

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

async function findSession(full: boolean): Promise<SessionSummary> {
  const response = await request(app).get('/api/training-sessions')
  const sessions: SessionSummary[] = response.body
  const session = sessions.find((s) =>
    full ? s.registered >= s.capacity : s.registered < s.capacity
  )
  if (!session) throw new Error(`No ${full ? 'full' : 'non-full'} session available for testing`)
  originalCounters.set(session.id, session.registered)
  return session
}

async function getRegistered(sessionId: number): Promise<number> {
  const res = await request(app).get(`/api/training-sessions/${sessionId}`)
  expect(res.status).toBe(200)
  return res.body.registered
}

describe('DELETE /api/training-sessions/:id/registrations/:registrationId', () => {
  it('WH-4 AC 8: cancelling a confirmed registration decrements registered by 1', async () => {
    const session = await findSession(false)
    const created = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: 'Test Canceller', email: `${TEST_EMAIL_PREFIX}confirmed@example.com` })
    expect(created.status).toBe(201)
    const registrationId: number = created.body.id
    const afterRegistering = await getRegistered(session.id)

    const res = await request(app).delete(
      `/api/training-sessions/${session.id}/registrations/${registrationId}`
    )
    expect(res.status).toBe(200)

    expect(await getRegistered(session.id)).toBe(afterRegistering - 1)
  })

  it('WH-4 AC 8: cancelling a waitlisted registration leaves registered unchanged', async () => {
    const session = await findSession(true)
    const created = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: 'Test Waitlister', email: `${TEST_EMAIL_PREFIX}waitlisted@example.com` })
    expect(created.status).toBe(202)
    const registrationId: number = created.body.id
    const before = await getRegistered(session.id)

    const res = await request(app).delete(
      `/api/training-sessions/${session.id}/registrations/${registrationId}`
    )
    expect(res.status).toBe(200)

    expect(await getRegistered(session.id)).toBe(before)
  })
})
