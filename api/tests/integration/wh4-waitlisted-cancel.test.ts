import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

const TEST_EMAIL_PREFIX = 'test-wh4-waitlisted-cancel-'

interface SessionSummary {
  id: number
  registered: number
  capacity: number
}

interface WaitlistResponseBody {
  status: string
  position: number
  id: number
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

async function getFullSession(): Promise<SessionSummary> {
  const response = await request(app).get('/api/training-sessions')
  const sessions: SessionSummary[] = response.body
  const session = sessions.find((s) => s.registered >= s.capacity)
  if (!session) throw new Error('No full session available for testing')
  originalCounters.set(session.id, session.registered)
  return session
}

async function joinWaitlist(sessionId: number, label: string): Promise<WaitlistResponseBody> {
  const res = await request(app)
    .post(`/api/training-sessions/${sessionId}/registrations`)
    .send({ name: `Test ${label}`, email: `${TEST_EMAIL_PREFIX}${label}@example.com` })
  expect(res.status).toBe(202)
  return res.body
}

describe('Cancelling a waitlisted registration (WH-4 clarification 1)', () => {
  it('WH-4 Clarification 1: the 202 waitlist response includes the registration id', async () => {
    const session = await getFullSession()

    const body = await joinWaitlist(session.id, 'a')

    expect(typeof body.id).toBe('number')
  })

  it('WH-4 Clarification 1: cancelling a waitlisted registration frees a waitlist place but no seat', async () => {
    const session = await getFullSession()
    const a = await joinWaitlist(session.id, 'a')
    const b = await joinWaitlist(session.id, 'b')
    const before = await request(app).get(`/api/training-sessions/${session.id}`)

    const res = await request(app).delete(
      `/api/training-sessions/${session.id}/registrations/${a.id}`
    )
    expect(res.status).toBe(200)

    const after = await request(app).get(`/api/training-sessions/${session.id}`)
    expect(after.body.registered).toBe(before.body.registered)

    // A's place is gone, so the next joiner takes the position B had.
    const c = await joinWaitlist(session.id, 'c')
    expect(c.position).toBe(b.position)
  })
})
