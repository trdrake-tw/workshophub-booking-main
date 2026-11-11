import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

const TEST_EMAIL_PREFIX = 'test-wh3-waitlisted-count-separate-'

interface SessionSummary {
  id: number
  registered: number
  capacity: number
}

interface SessionCounts {
  registered: number
  waitlisted: number
}

// Remembered so afterEach can restore the session counter if the POST changed it.
let touchedSession: { id: number; registered: number } | null = null

afterEach(async () => {
  await prisma.registration.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  })
  if (touchedSession) {
    await prisma.trainingSession.update({
      where: { id: touchedSession.id },
      data: { registered: touchedSession.registered },
    })
    touchedSession = null
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function getFullSession(): Promise<SessionSummary> {
  const res = await request(app).get('/api/training-sessions')
  const body: unknown = res.body
  if (!Array.isArray(body)) throw new Error('Expected an array of sessions')
  const sessions: SessionSummary[] = body.filter(
    (s: unknown): s is SessionSummary =>
      isRecord(s) &&
      typeof s.id === 'number' &&
      typeof s.registered === 'number' &&
      typeof s.capacity === 'number'
  )
  const full = sessions.find((s) => s.registered >= s.capacity)
  if (!full) throw new Error('No full session available for testing')
  return full
}

function waitlistedOf(body: unknown): number {
  return isRecord(body) && typeof body.waitlisted === 'number' ? body.waitlisted : 0
}

describe('GET /api/training-sessions/:id', () => {
  it('WH-3: waitlisted count is tracked separately from registered count', async () => {
    const session = await getFullSession()
    touchedSession = { id: session.id, registered: session.registered }

    const before = await request(app).get(`/api/training-sessions/${session.id}`)
    const waitlistedBefore = waitlistedOf(before.body)

    await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: 'Test Waitlister', email: `${TEST_EMAIL_PREFIX}1@example.com` })

    const res = await request(app).get(`/api/training-sessions/${session.id}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual(
      expect.objectContaining<SessionCounts>({
        registered: expect.any(Number),
        waitlisted: expect.any(Number),
      })
    )
    const body: unknown = res.body
    expect(isRecord(body) && body.waitlisted).toBe(waitlistedBefore + 1)
    expect(isRecord(body) && body.registered).toBe(session.registered)
  })
})
