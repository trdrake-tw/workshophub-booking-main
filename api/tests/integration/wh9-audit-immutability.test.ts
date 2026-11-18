import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

const TEST_EMAIL_PREFIX = 'test-wh9-audit-immutability-'

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

type ModifyingMethod = 'post' | 'put' | 'patch' | 'delete'

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

// A session with space and an empty waitlist, so registering confirms and cancelling promotes nobody.
async function getOpenSession(): Promise<SessionSummary> {
  const response = await request(app).get('/api/training-sessions')
  const sessions: SessionSummary[] = response.body
  const session = sessions.find((s) => s.registered < s.capacity && s.waitlisted === 0)
  if (!session) throw new Error('No suitable session available for testing')
  originalCounters.set(session.id, session.registered)
  return session
}

function registrationPath(sessionId: number, registrationId: number): string {
  return `/api/training-sessions/${sessionId}/registrations/${registrationId}`
}

function auditPath(sessionId: number, registrationId: number): string {
  return `${registrationPath(sessionId, registrationId)}/audit`
}

async function readHistory(sessionId: number, registrationId: number): Promise<AuditEntry[]> {
  const res = await request(app).get(auditPath(sessionId, registrationId))
  expect(res.status).toBe(200)
  const entries: AuditEntry[] = res.body
  return entries
}

async function registerConfirmed(sessionId: number, slug: string): Promise<number> {
  const res = await request(app)
    .post(`/api/training-sessions/${sessionId}/registrations`)
    .send({ name: 'Test Immutable', email: `${TEST_EMAIL_PREFIX}${slug}@example.com` })
  expect(res.status).toBe(201)
  const id: number = res.body.id
  return id
}

describe('GET /api/training-sessions/:id/registrations/:registrationId/audit', () => {
  it('WH-9 AC 8: modifying requests on the audit address are rejected and change nothing', async () => {
    const session = await getOpenSession()
    const registrationId = await registerConfirmed(session.id, 'modify')
    const before = await readHistory(session.id, registrationId)
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({
      registrationId,
      fromStatus: null,
      toStatus: 'confirmed',
      reason: 'registered',
    })

    const path = auditPath(session.id, registrationId)
    const methods: ModifyingMethod[] = ['post', 'put', 'patch', 'delete']
    for (const method of methods) {
      const res = await request(app)[method](path).send({ toStatus: 'cancelled' })
      expect({ method, status: res.status }).toEqual({ method, status: 404 })
    }

    const after = await readHistory(session.id, registrationId)
    expect(after).toEqual(before)
    const registration = await prisma.registration.findUnique({ where: { id: registrationId } })
    expect(registration?.status).toBe('confirmed')
  })

  it('WH-9 AC 8: no address exists for a single entry', async () => {
    const session = await getOpenSession()
    const registrationId = await registerConfirmed(session.id, 'single-entry')
    const before = await readHistory(session.id, registrationId)
    expect(before).toHaveLength(1)
    const entryPath = `${auditPath(session.id, registrationId)}/${before[0].id}`

    const getRes = await request(app).get(entryPath)
    expect(getRes.status).toBe(404)
    const modifying: Exclude<ModifyingMethod, 'post'>[] = ['put', 'patch', 'delete']
    for (const method of modifying) {
      const res = await request(app)[method](entryPath).send({ toStatus: 'cancelled' })
      expect({ method, status: res.status }).toEqual({ method, status: 404 })
    }

    const after = await readHistory(session.id, registrationId)
    expect(after).toEqual(before)
  })

  it('WH-9: reading the history twice returns the same entries', async () => {
    const session = await getOpenSession()
    const registrationId = await registerConfirmed(session.id, 'read-twice')
    const cancelled = await request(app).delete(registrationPath(session.id, registrationId))
    expect(cancelled.status).toBe(200)

    const first = await readHistory(session.id, registrationId)
    const second = await readHistory(session.id, registrationId)

    expect(first).toHaveLength(2)
    expect(first.map((e) => [e.fromStatus, e.toStatus, e.reason])).toEqual([
      [null, 'confirmed', 'registered'],
      ['confirmed', 'cancelled', 'cancelled'],
    ])
    expect(second).toEqual(first)
  })

  it('WH-9: entries are removed with their registration', async () => {
    const session = await getOpenSession()
    const registrationId = await registerConfirmed(session.id, 'cascade')
    const before = await prisma.auditLog.count({ where: { registrationId } })
    expect(before).toBe(1)

    await prisma.registration.delete({ where: { id: registrationId } })

    const after = await prisma.auditLog.count({ where: { registrationId } })
    expect(after).toBe(0)
  })
})
