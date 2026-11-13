import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

const TEST_EMAIL_PREFIX = 'test-wh5-registered-unchanged-on-promotion-'

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

describe('Seat accounting when a promotion occurs', () => {
  it('WH-5 AC 7: registered is unchanged when a promotion occurs', async () => {
    const { sessionId, confirmedId } = await setUpFullSession()
    const before = await request(app).get(`/api/training-sessions/${sessionId}`)
    expect(before.status).toBe(200)

    const res = await request(app).delete(
      `/api/training-sessions/${sessionId}/registrations/${confirmedId}`
    )
    expect(res.status).toBe(200)

    const after = await request(app).get(`/api/training-sessions/${sessionId}`)
    expect(after.body.registered).toBe(before.body.registered)
    expect(after.body.waitlisted).toBe(before.body.waitlisted - 1)
  })
})
