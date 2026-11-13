import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

const TEST_EMAIL_PREFIX = 'test-wh5-promotes-first-waitlisted-'

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

async function statusInDb(id: number): Promise<string | undefined> {
  const row = await prisma.registration.findUnique({ where: { id } })
  return row?.status
}

describe('Promotion after cancelling a confirmed registration', () => {
  it('WH-5 AC 5: cancelling a confirmed registration promotes the earliest waitlisted registration', async () => {
    const { sessionId, confirmedId, firstWaitlistedId, secondWaitlistedId } =
      await setUpFullSession()

    const res = await request(app).delete(
      `/api/training-sessions/${sessionId}/registrations/${confirmedId}`
    )

    expect(res.status).toBe(200)
    expect(res.body.promotedRegistrationId).toBe(firstWaitlistedId)
    expect(await statusInDb(firstWaitlistedId)).toBe('confirmed')
    expect(await statusInDb(secondWaitlistedId)).toBe('waitlisted')
  })

  it('WH-5 Clarification 3: a cancelled registration is never promoted', async () => {
    const { sessionId, confirmedId, firstWaitlistedId, secondWaitlistedId } =
      await setUpFullSession()
    const withdrawn = await request(app).delete(
      `/api/training-sessions/${sessionId}/registrations/${firstWaitlistedId}`
    )
    expect(withdrawn.status).toBe(200)

    const res = await request(app).delete(
      `/api/training-sessions/${sessionId}/registrations/${confirmedId}`
    )

    expect(res.status).toBe(200)
    expect(res.body.promotedRegistrationId).toBe(secondWaitlistedId)
  })
})
