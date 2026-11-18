import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

const TEST_EMAIL_PREFIX = 'test-wh9-audit-history-lookup-'
const NOT_FOUND_BODY = { error: 'Registration not found' }

interface SessionSummary {
  id: number
  registered: number
  capacity: number
}

interface Fixture {
  sessionId: number
  otherSessionId: number
  unknownSessionId: number
  registrationId: number
}

afterEach(async () => {
  await prisma.registration.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})

// The registration is created directly so it has no audit history.
async function setUpRegistration(): Promise<Fixture> {
  const response = await request(app).get('/api/training-sessions')
  const sessions: SessionSummary[] = response.body
  const session = sessions[0]
  if (!session) throw new Error('No session available for testing')
  const otherSession = sessions.find((s) => s.id !== session.id)
  if (!otherSession) throw new Error('No other session available for testing')
  const unknownSessionId = Math.max(...sessions.map((s) => s.id)) + 100000

  const registration = await prisma.registration.create({
    data: {
      sessionId: session.id,
      name: 'Test Audit Lookup',
      email: `${TEST_EMAIL_PREFIX}attendee@example.com`,
      status: 'confirmed',
    },
  })

  return {
    sessionId: session.id,
    otherSessionId: otherSession.id,
    unknownSessionId,
    registrationId: registration.id,
  }
}

function auditPath(sessionId: number | string, registrationId: number | string): string {
  return `/api/training-sessions/${sessionId}/registrations/${registrationId}/audit`
}

describe('GET /api/training-sessions/:id/registrations/:registrationId/audit', () => {
  it('WH-9: a registration with no audit entries returns 200 and an empty list', async () => {
    const { sessionId, registrationId } = await setUpRegistration()

    const res = await request(app).get(auditPath(sessionId, registrationId))

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('WH-9 AC 9: an unknown registration returns 404', async () => {
    const { sessionId } = await setUpRegistration()

    const res = await request(app).get(auditPath(sessionId, 999999999))

    expect(res.status).toBe(404)
    expect(res.body).toEqual(NOT_FOUND_BODY)
  })

  it('WH-9: an unknown session returns 404', async () => {
    const { unknownSessionId, registrationId } = await setUpRegistration()

    const res = await request(app).get(auditPath(unknownSessionId, registrationId))

    expect(res.status).toBe(404)
    expect(res.body).toEqual(NOT_FOUND_BODY)
  })

  it('WH-9: a registration requested under a different session returns 404', async () => {
    const { otherSessionId, registrationId } = await setUpRegistration()

    const res = await request(app).get(auditPath(otherSessionId, registrationId))

    expect(res.status).toBe(404)
    expect(res.body).toEqual(NOT_FOUND_BODY)
  })

  it('WH-9: malformed identifiers return 404', async () => {
    const { sessionId, registrationId } = await setUpRegistration()

    const paths = [
      ...['abc', '0', '-1', '1.5', '99999999999999999999'].map((id) => auditPath(sessionId, id)),
      auditPath('abc', registrationId),
    ]
    for (const path of paths) {
      const res = await request(app).get(path)
      expect({ path, status: res.status }).toEqual({ path, status: 404 })
      expect(res.body).toEqual(NOT_FOUND_BODY)
    }
  })
})
