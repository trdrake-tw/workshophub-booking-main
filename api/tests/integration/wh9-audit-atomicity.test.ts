import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'
import * as auditLogService from '../../src/services/auditLogService'

const TEST_EMAIL_PREFIX = 'test-wh9-audit-atomicity-'

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

// Captured before any spy is installed, so a test can let one call through for real.
const realRecordTransition = auditLogService.recordTransition

const originalCounters = new Map<number, number>()

beforeEach(() => {
  // The routes log the injected failure; keep the test output quiet.
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(async () => {
  // Restore every spy first so later suites write real audit entries.
  jest.restoreAllMocks()
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
  const session = await getOpenSession()
  await prisma.trainingSession.update({
    where: { id: session.id },
    data: { registered: session.capacity - 1 },
  })

  const confirmedId = await register(session.id, 'full-confirmed', 'Test Confirmed', 201)
  const firstWaitlistedId = await register(
    session.id,
    'full-first-waitlisted',
    'Test First Waitlisted',
    202
  )
  const secondWaitlistedId = await register(
    session.id,
    'full-second-waitlisted',
    'Test Second Waitlisted',
    202
  )
  return { sessionId: session.id, confirmedId, firstWaitlistedId, secondWaitlistedId }
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

async function readRegistered(sessionId: number): Promise<number | undefined> {
  const session = await prisma.trainingSession.findUnique({ where: { id: sessionId } })
  return session?.registered
}

async function readStatus(registrationId: number): Promise<string | undefined> {
  const registration = await prisma.registration.findUnique({ where: { id: registrationId } })
  return registration?.status
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

describe('POST /api/training-sessions/:id/registrations (audit write fails)', () => {
  it('WH-9 AC 6: a failed audit write rolls back the registration', async () => {
    const session = await getOpenSession()
    const registeredBefore = await readRegistered(session.id)
    const email = `${TEST_EMAIL_PREFIX}rolled-back@example.com`
    const spy = jest
      .spyOn(auditLogService, 'recordTransition')
      .mockRejectedValueOnce(new Error('audit write failed'))

    const res = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: 'Test Rolled Back', email })

    expect(spy).toHaveBeenCalled()
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Failed to register for training session' })
    expect(await prisma.registration.count({ where: { email } })).toBe(0)
    expect(await readRegistered(session.id)).toBe(registeredBefore)
  })
})

describe('DELETE /api/training-sessions/:id/registrations/:registrationId (audit write fails)', () => {
  it('WH-9 AC 6: a failed audit write rolls back the cancellation', async () => {
    const session = await getOpenSession()
    const registrationId = await register(session.id, 'cancel', 'Test Canceller', 201)
    const registeredBefore = await readRegistered(session.id)
    const spy = jest
      .spyOn(auditLogService, 'recordTransition')
      .mockRejectedValueOnce(new Error('audit write failed'))

    const res = await request(app).delete(registrationPath(session.id, registrationId))

    expect(spy).toHaveBeenCalled()
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Failed to cancel registration' })
    expect(await readStatus(registrationId)).toBe('confirmed')
    expect(await readRegistered(session.id)).toBe(registeredBefore)
    expect(await readHistory(session.id, registrationId)).toEqual([
      entry(registrationId, null, 'confirmed', 'registered'),
    ])
  })

  it('WH-9 AC 6: a failed promotion entry rolls back the cancellation and the promotion', async () => {
    const { sessionId, confirmedId, firstWaitlistedId } = await setUpFullSession()
    // First call (the cancellation entry) runs for real; the second (the promotion entry) fails.
    const spy = jest
      .spyOn(auditLogService, 'recordTransition')
      .mockImplementationOnce(realRecordTransition)
      .mockRejectedValueOnce(new Error('audit write failed'))

    const res = await request(app).delete(registrationPath(sessionId, confirmedId))

    expect(spy).toHaveBeenCalledTimes(2)
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Failed to cancel registration' })
    expect(await readStatus(confirmedId)).toBe('confirmed')
    expect(await readStatus(firstWaitlistedId)).toBe('waitlisted')
    expect(await readHistory(sessionId, confirmedId)).toEqual([
      entry(confirmedId, null, 'confirmed', 'registered'),
    ])
    expect(await readHistory(sessionId, firstWaitlistedId)).toEqual([
      entry(firstWaitlistedId, null, 'waitlisted', 'waitlisted'),
    ])
  })
})
