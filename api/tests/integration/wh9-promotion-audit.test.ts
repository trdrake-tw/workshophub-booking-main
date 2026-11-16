import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

const TEST_EMAIL_PREFIX = 'test-wh9-promotion-audit-'

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

interface FullSessionFixture {
  sessionId: number
  confirmedId: number
  firstWaitlistedId: number
  secondWaitlistedId: number
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

async function register(
  sessionId: number,
  label: string,
  name: string,
  expected: number
): Promise<number> {
  const res = await request(app)
    .post(`/api/training-sessions/${sessionId}/registrations`)
    .send({ name, email: `${TEST_EMAIL_PREFIX}${label}@example.com` })
  expect(res.status).toBe(expected)
  const id: number = res.body.id
  return id
}

// One confirmed registration fills the last seat; two more join the waitlist.
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

function registrationPath(sessionId: number, registrationId: number): string {
  return `/api/training-sessions/${sessionId}/registrations/${registrationId}`
}

async function cancel(sessionId: number, registrationId: number): Promise<void> {
  const res = await request(app).delete(registrationPath(sessionId, registrationId))
  expect(res.status).toBe(200)
}

async function readHistory(sessionId: number, registrationId: number): Promise<AuditEntry[]> {
  const res = await request(app).get(`${registrationPath(sessionId, registrationId)}/audit`)
  expect(res.status).toBe(200)
  const entries: AuditEntry[] = res.body
  return entries
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

describe('DELETE /api/training-sessions/:id/registrations/:registrationId (promotion)', () => {
  it('WH-9 AC 3: a promoted registration shows null to waitlisted then waitlisted to confirmed', async () => {
    const { sessionId, confirmedId, firstWaitlistedId } = await setUpFullSession()

    await cancel(sessionId, confirmedId)

    const entries = await readHistory(sessionId, firstWaitlistedId)
    expect(entries).toEqual([
      entry(firstWaitlistedId, null, 'waitlisted', 'waitlisted'),
      entry(firstWaitlistedId, 'waitlisted', 'confirmed', 'promoted'),
    ])
  })

  it("WH-9: each registration's history holds only its own entries", async () => {
    const { sessionId, confirmedId, firstWaitlistedId, secondWaitlistedId } =
      await setUpFullSession()

    await cancel(sessionId, confirmedId)

    const cancelledHistory = await readHistory(sessionId, confirmedId)
    const promotedHistory = await readHistory(sessionId, firstWaitlistedId)
    const stillWaitingHistory = await readHistory(sessionId, secondWaitlistedId)

    expect(cancelledHistory).toEqual([
      entry(confirmedId, null, 'confirmed', 'registered'),
      entry(confirmedId, 'confirmed', 'cancelled', 'cancelled'),
    ])
    expect(promotedHistory).toEqual([
      entry(firstWaitlistedId, null, 'waitlisted', 'waitlisted'),
      entry(firstWaitlistedId, 'waitlisted', 'confirmed', 'promoted'),
    ])
    expect(stillWaitingHistory).toEqual([
      entry(secondWaitlistedId, null, 'waitlisted', 'waitlisted'),
    ])
    for (const e of cancelledHistory) expect(e.registrationId).toBe(confirmedId)
    for (const e of promotedHistory) expect(e.registrationId).toBe(firstWaitlistedId)
    for (const e of stillWaitingHistory) expect(e.registrationId).toBe(secondWaitlistedId)
  })

  it('WH-9 AC 7: a full lifecycle is returned in chronological order without gaps', async () => {
    const { sessionId, confirmedId, firstWaitlistedId } = await setUpFullSession()

    await cancel(sessionId, confirmedId)
    await cancel(sessionId, firstWaitlistedId)

    const entries = await readHistory(sessionId, firstWaitlistedId)

    expect(entries).toEqual([
      entry(firstWaitlistedId, null, 'waitlisted', 'waitlisted'),
      entry(firstWaitlistedId, 'waitlisted', 'confirmed', 'promoted'),
      entry(firstWaitlistedId, 'confirmed', 'cancelled', 'cancelled'),
    ])
    for (const e of entries) {
      expect(Number.isNaN(new Date(e.changedAt).getTime())).toBe(false)
    }
    for (let i = 1; i < entries.length; i++) {
      const previous = entries[i - 1]
      const current = entries[i]
      expect(new Date(current.changedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(previous.changedAt).getTime()
      )
      expect(current.id).toBeGreaterThan(previous.id)
      expect(current.fromStatus).toBe(previous.toStatus)
    }
  })
})
