import request from 'supertest'
import app from '../../src/app'
import prisma from '../../src/lib/prisma'

// Isolation: every test that creates a registration deletes it afterwards and
// restores any session counter it changed, so the shared dev DB is left as found.
const TEST_EMAIL_PREFIX = 'test-'

afterEach(async () => {
  await prisma.registration.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function getNonFullSession() {
  const response = await request(app).get('/api/training-sessions')
  const session = response.body.find(
    (s: { registered: number; capacity: number }) => s.registered < s.capacity
  )
  if (!session) throw new Error('No non-full session available for testing')
  return session as { id: number; registered: number; capacity: number }
}

async function getFullSession() {
  const response = await request(app).get('/api/training-sessions')
  const session = response.body.find(
    (s: { registered: number; capacity: number }) => s.registered >= s.capacity
  )
  if (!session) throw new Error('No full session available for testing')
  return session as { id: number; registered: number; capacity: number }
}

describe('GET /api/training-sessions', () => {
  it('returns 200 with an array of sessions', async () => {
    const response = await request(app).get('/api/training-sessions')
    expect(response.status).toBe(200)
    expect(Array.isArray(response.body)).toBe(true)
  })

  it('returns sessions with expected fields', async () => {
    const response = await request(app).get('/api/training-sessions')
    expect(response.status).toBe(200)
    if (response.body.length > 0) {
      const session = response.body[0]
      expect(session).toHaveProperty('id')
      expect(session).toHaveProperty('title')
      expect(session).toHaveProperty('description')
      expect(session).toHaveProperty('date')
      expect(session).toHaveProperty('capacity')
      expect(session).toHaveProperty('registered')
      expect(session).toHaveProperty('waitlisted')
      expect(session).toHaveProperty('location')
      expect(session).toHaveProperty('deliveryMode')
      expect(session).toHaveProperty('status')
    }
  })
})

describe('GET /api/training-sessions/:id', () => {
  it('returns 200 with a session when id exists', async () => {
    const allResponse = await request(app).get('/api/training-sessions')
    expect(allResponse.status).toBe(200)
    expect(allResponse.body.length).toBeGreaterThan(0)

    const firstId = allResponse.body[0].id
    const response = await request(app).get(`/api/training-sessions/${firstId}`)
    expect(response.status).toBe(200)
    expect(response.body.id).toBe(firstId)
  })

  it('returns 404 when session does not exist', async () => {
    const response = await request(app).get('/api/training-sessions/999999')
    expect(response.status).toBe(404)
    expect(response.body.error).toBeDefined()
  })

  it('returns 400 for invalid id', async () => {
    const response = await request(app).get('/api/training-sessions/not-a-number')
    expect(response.status).toBe(400)
  })
})

describe('POST /api/training-sessions/:id/registrations', () => {
  it('returns 201 with the created registration', async () => {
    const session = await getNonFullSession()
    const response = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: 'Test Attendee', email: 'test-attendee@example.com' })

    // Restore the counter before asserting, so a failure doesn't leak an increment.
    await prisma.trainingSession.update({
      where: { id: session.id },
      data: { registered: session.registered },
    })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      sessionId: session.id,
      name: 'Test Attendee',
      email: 'test-attendee@example.com',
      status: 'confirmed',
    })
    expect(response.body.id).toBeDefined()
    expect(response.body.createdAt).toBeDefined()
  })

  it('increments registered by exactly 1 and restores the counter', async () => {
    const session = await getNonFullSession()
    const original = session.registered

    const postResponse = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: 'Test Attendee', email: 'test-counter@example.com' })
    expect(postResponse.status).toBe(201)

    const afterResponse = await request(app).get(`/api/training-sessions/${session.id}`)
    expect(afterResponse.status).toBe(200)
    expect(afterResponse.body.registered).toBe(original + 1)

    // Restore the counter so subsequent tests see the original value.
    await prisma.trainingSession.update({
      where: { id: session.id },
      data: { registered: original },
    })
  })

  it('returns 400 with error for missing fields', async () => {
    const session = await getNonFullSession()
    const response = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({})

    expect(response.status).toBe(400)
    expect(response.body.error).toBeDefined()
  })

  it('returns 400 when name is whitespace-only', async () => {
    const session = await getNonFullSession()
    const response = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: '   ', email: 'test-whitespace@example.com' })

    expect(response.status).toBe(400)
    expect(response.body.error).toBeDefined()
  })

  it('returns 400 for invalid email format', async () => {
    const session = await getNonFullSession()
    const response = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: 'A', email: 'not-an-email' })

    expect(response.status).toBe(400)
    expect(response.body.error).toBeDefined()
  })

  it('returns 404 for non-numeric id', async () => {
    const response = await request(app)
      .post('/api/training-sessions/abc/registrations')
      .send({ name: 'Test Attendee', email: 'test-attendee@example.com' })

    expect(response.status).toBe(404)
    expect(response.body.error).toBeDefined()
  })

  it('returns 404 for unknown session id', async () => {
    const response = await request(app)
      .post('/api/training-sessions/999999/registrations')
      .send({ name: 'Test Attendee', email: 'test-attendee@example.com' })

    expect(response.status).toBe(404)
    expect(response.body.error).toBeDefined()
  })

  it('returns 202 waitlisted when the session is full and leaves registered unchanged', async () => {
    const session = await getFullSession()
    const original = session.registered

    const response = await request(app)
      .post(`/api/training-sessions/${session.id}/registrations`)
      .send({ name: 'Test Attendee', email: 'test-full@example.com' })

    expect(response.status).toBe(202)
    expect(response.body.status).toBe('waitlisted')
    expect(response.body.position).toBeGreaterThanOrEqual(1)

    const afterResponse = await request(app).get(`/api/training-sessions/${session.id}`)
    expect(afterResponse.status).toBe(200)
    expect(afterResponse.body.registered).toBe(original)
  })
})
