import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

const TEST_EMAIL_PREFIX = 'test-wh9-cancellation-audit-'

interface SessionSummary {
  id: number
  registered: number
  capacity: number
  waitlisted: number
}

interface AuditEntry {
  id: number
  registrationId: number
  fromStatus: string | null
  toStatus: string
  changedAt: string
  reason: string | null
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

// A session with space and an empty waitlist, so a cancellation promotes nobody.
async function getOpenSession(): Promise<SessionSummary> {
  const response = await request(app).get('/api/training-sessions')
  const sessions: SessionSummary[] = response.body
  const session = sessions.find((s) => s.registered < s.capacity && s.waitlisted === 0)
  if (!session) throw new Error('No suitable session available for testing')
  originalCounters.set(session.id, session.registered)
  return session
}

async function getFullSession(): Promise<SessionSummary> {
  const session = await getOpenSession()
  await prisma.trainingSession.update({
    where: { id: session.id },
    data: { registered: session.capacity },
  })
  return session
}

function registrationPath(sessionId: number, registrationId: number): string {
  return `/api/training-sessions/${sessionId}/registrations/${registrationId}`
}

async function readHistory(sessionId: number, registrationId: number): Promise<AuditEntry[]> {
  const res = await request(app).get(`${registrationPath(sessionId, registrationId)}/audit`)
  expect(res.status).toBe(200)
  const entries: AuditEntry[] = res.body
  return entries
}

async function registerConfirmed(sessionId: number, slug: string): Promise<number> {
  const res = await request(app)
    .post(`/api/training-sessions/${sessionId}/registrations`)
    .send({ name: 'Test Canceller', email: `${TEST_EMAIL_PREFIX}${slug}@example.com` })
  expect(res.status).toBe(201)
  const id: number = res.body.id
  return id
}

function entry(
  registrationId: number,
  fromStatus: string | null,
  toStatus: string,
  reason: string
): AuditEntry {
  return {
    id: expect.any(Number),
    registrationId,
    fromStatus,
    toStatus,
    changedAt: expect.any(String),
    reason,
  }
}

describe('DELETE /api/training-sessions/:id/registrations/:registrationId', () => {
  it('WH-9 AC 3: cancelling a confirmed registration appends confirmed to cancelled', async () => {
    const session = await getOpenSession()
    const registrationId = await registerConfirmed(session.id, 'confirmed')

    const cancelled = await request(app).delete(registrationPath(session.id, registrationId))
    expect(cancelled.status).toBe(200)

    const entries = await readHistory(session.id, registrationId)

    expect(entries).toEqual([
      entry(registrationId, null, 'confirmed', 'registered'),
      entry(registrationId, 'confirmed', 'cancelled', 'cancelled'),
    ])
  })

  it('WH-9: cancelling a waitlisted registration appends waitlisted to cancelled', async () => {
    const session = await getFullSession()
    const created = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: 'Test Waitlisted', email: `${TEST_EMAIL_PREFIX}waitlisted@example.com` })
    expect(created.status).toBe(202)
    const registrationId: number = created.body.id

    const cancelled = await request(app).delete(registrationPath(session.id, registrationId))
    expect(cancelled.status).toBe(200)

    const entries = await readHistory(session.id, registrationId)

    expect(entries).toEqual([
      entry(registrationId, null, 'waitlisted', 'waitlisted'),
      entry(registrationId, 'waitlisted', 'cancelled', 'cancelled'),
    ])
  })

  it('WH-9: a repeated cancel is rejected and writes no entry', async () => {
    const session = await getOpenSession()
    const registrationId = await registerConfirmed(session.id, 'repeated')
    const path = registrationPath(session.id, registrationId)

    const first = await request(app).delete(path)
    const second = await request(app).delete(path)

    expect(first.status).toBe(200)
    expect(second.status).toBe(409)
    const entries = await readHistory(session.id, registrationId)
    expect(entries).toEqual([
      entry(registrationId, null, 'confirmed', 'registered'),
      entry(registrationId, 'confirmed', 'cancelled', 'cancelled'),
    ])
  })

  it('WH-9: the cancellation response is unchanged', async () => {
    const session = await getOpenSession()
    const registrationId = await registerConfirmed(session.id, 'unchanged')

    const res = await request(app).delete(registrationPath(session.id, registrationId))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'cancelled', promotedRegistrationId: null })
  })
})
