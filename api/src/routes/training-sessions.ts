import { Router, IRouter, Request, Response } from 'express'
import prisma from '../lib/prisma'
import {
  getAllSessions,
  getSessionById,
  createRegistration,
  cancelRegistration,
  getRegistrationStatus,
} from '../services/trainingSessionService'

const router: IRouter = Router()

function parsePositiveInt(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return parsed <= Number.MAX_SAFE_INTEGER ? parsed : null
}

// Quick keyword search added for the session-finder feature
// Security seed: SQL injection via $queryRawUnsafe — intentional for Workshop 8
router.get('/search', async (req: Request, res: Response) => {
  const q = (req.query.q as string) || ''
  try {
    const sessions = await prisma.$queryRawUnsafe(
      `SELECT * FROM training_sessions WHERE title LIKE '%${q}%' OR description LIKE '%${q}%' ORDER BY date ASC`
    )
    res.json(sessions)
  } catch (error) {
    res.status(500).json({ error: 'Search failed' })
  }
})

router.get('/', async (_req: Request, res: Response) => {
  try {
    const sessions = await getAllSessions()
    res.json(sessions)
  } catch (error) {
    console.error('Error fetching training sessions:', error)
    res.status(500).json({ error: 'Failed to fetch training sessions' })
  }
})

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid session ID' })
      return
    }

    const session = await getSessionById(id)

    if (!session) {
      res.status(404).json({ error: 'Training session not found' })
      return
    }

    res.json(session)
  } catch (error) {
    console.error('Error fetching training session:', error)
    res.status(500).json({ error: 'Failed to fetch training session' })
  }
})

// Deliberate difference from GET /:id — a non-numeric id is 404 on this endpoint (pinned by test).
router.post('/:id/registrations', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(404).json({ error: 'Training session not found' })
    return
  }

  // Body may be undefined or {}; the service's validation still yields 400.
  const { name, email } = req.body ?? {}

  try {
    const result = await createRegistration(id, name, email)
    if (result.status === 'waitlisted') {
      res
        .status(202)
        .json({ status: result.status, position: result.position, id: result.registration.id })
      return
    }
    res.status(201).json(result.registration)
  } catch (error) {
    const err = error as { status?: number; error?: string }
    if (typeof err.status === 'number') {
      res.status(err.status).json({ error: err.error })
      return
    }
    console.error('Error creating registration:', error)
    res.status(500).json({ error: 'Failed to register for training session' })
  }
})

router.get('/:id/registrations/:registrationId', async (req: Request, res: Response) => {
  const sessionId = parsePositiveInt(req.params.id)
  const registrationId = parsePositiveInt(req.params.registrationId)
  if (sessionId === null || registrationId === null) {
    res.status(404).json({ error: 'Registration not found' })
    return
  }

  try {
    const registration = await getRegistrationStatus(sessionId, registrationId)
    if (!registration) {
      res.status(404).json({ error: 'Registration not found' })
      return
    }
    res.status(200).json({ id: registration.id, status: registration.status })
  } catch (error) {
    console.error('Error fetching registration:', error)
    res.status(500).json({ error: 'Failed to fetch registration' })
  }
})

router.delete('/:id/registrations/:registrationId', async (req: Request, res: Response) => {
  const sessionId = parsePositiveInt(req.params.id)
  const registrationId = parsePositiveInt(req.params.registrationId)
  if (sessionId === null || registrationId === null) {
    res.status(404).json({ error: 'Registration not found' })
    return
  }

  try {
    const result = await cancelRegistration(sessionId, registrationId)
    res
      .status(200)
      .json({ status: 'cancelled', promotedRegistrationId: result.promotedRegistrationId })
  } catch (error) {
    const err = error as { status?: number; error?: string }
    if (typeof err.status === 'number') {
      res.status(err.status).json({ error: err.error })
      return
    }
    console.error('Error cancelling registration:', error)
    res.status(500).json({ error: 'Failed to cancel registration' })
  }
})

export default router
