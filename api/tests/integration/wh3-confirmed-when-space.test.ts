import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

const TEST_EMAIL_PREFIX = 'test-wh3-confirmed-when-space-'

interface SessionSummary {
  id: number
  registered: number
  capacity: number
}

interface RegistrationBody {
  id: number
  sessionId: number
  name: string
  email: string
  status: string
  createdAt: string
}

let restore: { id: number; registered: number } | null = null

afterEach(async () => {
  await prisma.registration.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  })
  if (restore) {
    await prisma.trainingSession.update({
      where: { id: restore.id },
      data: { registered: restore.registered },
    })
    restore = null
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function getNonFullSession(): Promise<SessionSummary> {
  const response = await request(app).get('/api/training-sessions')
  const sessions = response.body as SessionSummary[]
  const session = sessions.find((s) => s.registered < s.capacity)
  if (!session) throw new Error('No non-full session available for testing')
  return session
}

describe('POST /api/training-sessions/:id/registrations', () => {
  it('WH-3: returns 201 and stores the registration with status "confirmed" when the session has space', async () => {
    const session = await getNonFullSession()
    restore = { id: session.id, registered: session.registered }
    const email = `${TEST_EMAIL_PREFIX}attendee@example.com`

    const res = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: 'Test Attendee', email })

    expect(res.status).toBe(201)
    expect(res.body).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        sessionId: session.id,
        email,
        status: expect.any(String),
      })
    )
    const body = res.body as RegistrationBody
    expect(body.status).toBe('confirmed')

    const stored = await prisma.registration.findUnique({ where: { id: body.id } })
    expect(stored?.status).toBe('confirmed')
  })
})
