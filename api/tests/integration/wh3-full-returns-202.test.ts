import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

// Isolation: delete only the registrations this file creates, and restore the
// session's registered counter if the request changed it.
const TEST_EMAIL_PREFIX = 'test-wh3-full-returns-202-'

interface SessionSummary {
  id: number
  registered: number
  capacity: number
}

interface WaitlistResponseBody {
  status: string
  position: number
}

let touchedSession: SessionSummary | null = null

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

function isSessionSummary(value: unknown): value is SessionSummary {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'number' && typeof v.registered === 'number' && typeof v.capacity === 'number'
  )
}

async function getFullSession(): Promise<SessionSummary> {
  const response = await request(app).get('/api/training-sessions')
  const body: unknown = response.body
  if (!Array.isArray(body)) throw new Error('Expected an array of sessions')
  const session = body.filter(isSessionSummary).find((s) => s.registered >= s.capacity)
  if (!session) throw new Error('No full session available for testing')
  return session
}

describe('POST /api/training-sessions/:id/registrations', () => {
  it('WH-3: returns 202 with { status: "waitlisted", position: N } when the session is full', async () => {
    const session = await getFullSession()
    touchedSession = { ...session }

    const res = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({
        name: 'Test Waitlister',
        email: `${TEST_EMAIL_PREFIX}one@example.com`,
      })

    expect(res.status).toBe(202)

    const body: WaitlistResponseBody = res.body
    expect(body).toEqual(
      expect.objectContaining({
        status: expect.any(String),
        position: expect.any(Number),
      })
    )
    expect(body.status).toBe('waitlisted')
    expect(body.position).toBeGreaterThanOrEqual(1)
  })
})
