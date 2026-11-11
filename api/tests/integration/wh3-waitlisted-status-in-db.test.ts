import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

const TEST_EMAIL_PREFIX = 'test-wh3-waitlisted-status-in-db-'

interface SessionSummary {
  id: number
  registered: number
  capacity: number
}

let restoreCounter: { id: number; registered: number } | null = null

afterEach(async () => {
  await prisma.registration.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  })
  if (restoreCounter) {
    await prisma.trainingSession.update({
      where: { id: restoreCounter.id },
      data: { registered: restoreCounter.registered },
    })
    restoreCounter = null
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function getFullSession(): Promise<SessionSummary> {
  const response = await request(app).get('/api/training-sessions')
  const sessions: SessionSummary[] = response.body
  const session = sessions.find((s) => s.registered >= s.capacity)
  if (!session) throw new Error('No full session available for testing')
  return session
}

describe('POST /api/training-sessions/:id/registrations', () => {
  it('WH-3: waitlisted registrations have status waitlisted in the database', async () => {
    const session = await getFullSession()
    restoreCounter = { id: session.id, registered: session.registered }
    const email = `${TEST_EMAIL_PREFIX}one@example.com`

    const res = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: 'Test Waitlister', email })

    expect(res.status).toBe(202)

    const row = await prisma.registration.findFirst({
      where: { email, sessionId: session.id },
    })

    expect(row).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        sessionId: session.id,
        email,
        status: expect.any(String),
        createdAt: expect.any(Date),
      })
    )
    expect(row?.status).toBe('waitlisted')
  })
})
