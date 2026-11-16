import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

const TEST_EMAIL_PREFIX = 'test-wh9-initial-registration-audit-'

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

// A session with space and an empty waitlist; its counter is restored in afterEach.
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

function auditPath(sessionId: number, registrationId: number): string {
  return `/api/training-sessions/${sessionId}/registrations/${registrationId}/audit`
}

async function readHistory(sessionId: number, registrationId: number): Promise<AuditEntry[]> {
  const res = await request(app).get(auditPath(sessionId, registrationId))
  expect(res.status).toBe(200)
  const entries: AuditEntry[] = res.body
  return entries
}

describe('POST /api/training-sessions/:id/registrations', () => {
  it('WH-9 AC 10: a confirmed registration has one entry from null to confirmed', async () => {
    const session = await getOpenSession()

    const res = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: 'Test Confirmed', email: `${TEST_EMAIL_PREFIX}confirmed@example.com` })
    expect(res.status).toBe(201)
    const registrationId: number = res.body.id

    const entries = await readHistory(session.id, registrationId)

    expect(entries).toEqual([
      {
        id: expect.any(Number),
        registrationId,
        fromStatus: null,
        toStatus: 'confirmed',
        changedAt: expect.any(String),
        reason: 'registered',
      },
    ])
    expect(new Date(entries[0].changedAt).toISOString()).toBe(entries[0].changedAt)
  })

  it('WH-9 AC 10: a waitlisted registration has one entry from null to waitlisted', async () => {
    const session = await getFullSession()

    const res = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: 'Test Waitlisted', email: `${TEST_EMAIL_PREFIX}waitlisted@example.com` })
    expect(res.status).toBe(202)
    const registrationId: number = res.body.id

    const entries = await readHistory(session.id, registrationId)

    expect(entries).toEqual([
      {
        id: expect.any(Number),
        registrationId,
        fromStatus: null,
        toStatus: 'waitlisted',
        changedAt: expect.any(String),
        reason: 'waitlisted',
      },
    ])
  })

  it('WH-9: a rejected registration writes no entry', async () => {
    const session = await getOpenSession()
    const before = await prisma.auditLog.count()

    const invalid = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: 'Test Invalid', email: 'not-an-email' })
    const unknown = await request(app)
      .post('/api/training-sessions/999999/registrations')
      .send({ name: 'Test Unknown', email: `${TEST_EMAIL_PREFIX}unknown@example.com` })

    expect(invalid.status).toBe(400)
    expect(unknown.status).toBe(404)
    expect(await prisma.auditLog.count()).toBe(before)
  })

  it('WH-9: the registration responses are unchanged', async () => {
    const open = await getOpenSession()
    const confirmedEmail = `${TEST_EMAIL_PREFIX}unchanged-confirmed@example.com`
    const confirmed = await request(app)
      .post(`/api/training-sessions/${open.id}/registrations`)
      .send({ name: 'Test Unchanged', email: confirmedEmail })

    expect(confirmed.status).toBe(201)
    const row = await prisma.registration.findUnique({ where: { id: confirmed.body.id } })
    if (!row) throw new Error('Confirmed registration was not persisted')
    expect(confirmed.body).toEqual({
      id: row.id,
      sessionId: open.id,
      name: 'Test Unchanged',
      email: confirmedEmail,
      status: 'confirmed',
      createdAt: row.createdAt.toISOString(),
    })

    // Fill the same session (its original counter is already remembered) so the next one waits.
    await prisma.trainingSession.update({
      where: { id: open.id },
      data: { registered: open.capacity },
    })
    const waitlisted = await request(app)
      .post(`/api/training-sessions/${open.id}/registrations`)
      .send({
        name: 'Test Unchanged Waitlisted',
        email: `${TEST_EMAIL_PREFIX}unchanged-waitlisted@example.com`,
      })

    expect(waitlisted.status).toBe(202)
    expect(waitlisted.body).toEqual({ status: 'waitlisted', position: 1, id: expect.any(Number) })
  })
})
