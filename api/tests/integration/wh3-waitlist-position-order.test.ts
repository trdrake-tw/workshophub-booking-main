import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

// Isolation: this file creates its own full session (capacity 1, one confirmed
// registration) so no other test file's waitlisted registrations can affect the
// positions. Everything it creates is deleted afterwards.
const TEST_EMAIL_PREFIX = 'test-wh3-waitlist-position-order-'
const FIXTURE_TITLE = 'test-wh3-waitlist-position-order full fixture'

interface WaitlistResponseBody {
  status: string
  position: number
}

let sessionId: number

beforeEach(async () => {
  const session = await prisma.trainingSession.create({
    data: {
      title: FIXTURE_TITLE,
      description: 'Temporary full session for the WH-3 waitlist position test.',
      date: new Date('2099-01-01T09:00:00.000Z'),
      capacity: 1,
      registered: 1,
      location: 'Test Room',
      deliveryMode: 'in-person',
    },
  })
  sessionId = session.id

  await prisma.registration.create({
    data: {
      sessionId,
      name: 'Confirmed Attendee',
      email: `${TEST_EMAIL_PREFIX}confirmed@example.com`,
      status: 'confirmed',
    },
  })
})

afterEach(async () => {
  await prisma.registration.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  })
  await prisma.trainingSession.deleteMany({
    where: { title: FIXTURE_TITLE },
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /api/training-sessions/:id/registrations', () => {
  it('WH-3: two successive POSTs to the same full session get position 1 and position 2', async () => {
    const first = await request(app)
      .post(`/api/training-sessions/${sessionId}/registrations`)
      .send({ name: 'First Waitlister', email: `${TEST_EMAIL_PREFIX}first@example.com` })

    const second = await request(app)
      .post(`/api/training-sessions/${sessionId}/registrations`)
      .send({ name: 'Second Waitlister', email: `${TEST_EMAIL_PREFIX}second@example.com` })

    expect(first.status).toBe(202)
    expect(second.status).toBe(202)

    const firstBody: WaitlistResponseBody = first.body
    const secondBody: WaitlistResponseBody = second.body

    expect(firstBody).toEqual(
      expect.objectContaining({ status: expect.any(String), position: expect.any(Number) })
    )
    expect(secondBody).toEqual(
      expect.objectContaining({ status: expect.any(String), position: expect.any(Number) })
    )

    expect(firstBody.status).toBe('waitlisted')
    expect(firstBody.position).toBe(1)
    expect(secondBody.status).toBe('waitlisted')
    expect(secondBody.position).toBe(2)
  })
})
