import { useEffect, useState, type FormEvent } from 'react'
import type { MyRegistration, Registration, TrainingSession, WaitlistResponse } from '../types'
import {
  forgetMyRegistration,
  getMyRegistration,
  markMyRegistrationCancelled,
  saveMyRegistration,
} from '../lib/myRegistrations'
import './TrainingSessionCard.css'

const API_BASE = import.meta.env.VITE_API_URL || ''

interface Props {
  session: TrainingSession
  onRegistered: () => void
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-SG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function deliveryModeLabel(mode: string): string {
  const labels: Record<string, string> = {
    'in-person': 'In Person',
    online: 'Online',
    hybrid: 'Hybrid',
  }
  return labels[mode] ?? mode
}

function TrainingSessionCard({ session, onRegistered }: Props) {
  const spotsLeft = session.capacity - session.registered
  const isFull = spotsLeft <= 0
  const isLowSpots = !isFull && spotsLeft >= 1 && spotsLeft <= 3

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [myRegistration, setMyRegistration] = useState<MyRegistration | null>(() =>
    getMyRegistration(session)
  )
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const actionLabel = isFull ? 'Join Waitlist' : 'Register'

  useEffect(() => {
    setMyRegistration(getMyRegistration(session))
  }, [session])

  function resetForm() {
    setName('')
    setEmail('')
    setFormError(null)
  }

  function handleCancel() {
    setShowForm(false)
    resetForm()
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // Double-submit guard: the disabled button is only a convenience, the API enforces the rules.
    if (submitting) return
    setSubmitting(true)
    setFormError(null)
    setSuccessMessage(null)

    try {
      const res = await fetch(`${API_BASE}/api/training-sessions/${session.id}/registrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      })

      if (res.ok) {
        // 202 = waitlisted (session full); 201 = confirmed seat.
        if (res.status === 202) {
          const body = (await res.json()) as WaitlistResponse
          saveMyRegistration(session, body.id, 'waitlisted')
          setMyRegistration(getMyRegistration(session))
          setSuccessMessage(
            `You're on the waitlist (position ${body.position}). You are not confirmed yet; we'll let you know if a place opens up.`
          )
        } else {
          const body = (await res.json()) as Registration
          saveMyRegistration(session, body.id, 'confirmed')
          setMyRegistration(getMyRegistration(session))
          setSuccessMessage(`You're confirmed for this session, ${body.name}.`)
        }
        setShowForm(false)
        setName('')
        setEmail('')
        // The page refetches so every card shows the server-authoritative count.
        onRegistered()
        return
      }

      let message = 'Something went wrong. Please try again.'
      try {
        const body = (await res.json()) as { error?: string }
        if (res.status === 400 && body?.error) {
          message = body.error
        } else if (res.status === 404) {
          message = 'Training session not found.'
        }
      } catch {
        // Non-JSON body: keep the generic message.
      }
      setFormError(message)
    } catch {
      setFormError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleConfirmCancel() {
    if (cancelling || myRegistration === null) return
    setCancelling(true)
    setFormError(null)
    setSuccessMessage(null)

    try {
      const res = await fetch(
        `${API_BASE}/api/training-sessions/${session.id}/registrations/${myRegistration.registrationId}`,
        { method: 'DELETE' }
      )

      if (res.status === 200) {
        markMyRegistrationCancelled(session.id)
        setMyRegistration(getMyRegistration(session))
        setSuccessMessage('Your registration has been cancelled')
        setConfirmingCancel(false)
        onRegistered()
        return
      }
      if (res.status === 409) {
        markMyRegistrationCancelled(session.id)
        setMyRegistration(getMyRegistration(session))
        setSuccessMessage('This registration was already cancelled')
        setConfirmingCancel(false)
        return
      }
      if (res.status === 404) {
        forgetMyRegistration(session.id)
        setMyRegistration(getMyRegistration(session))
        setFormError('We could not find that registration. It may have been removed.')
        setConfirmingCancel(false)
        return
      }
      setFormError('Something went wrong. Please try again.')
    } catch {
      setFormError('Something went wrong. Please try again.')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <article className={`session-card ${isFull ? 'session-card--full' : ''}`}>
      <div className="session-card__header">
        <span className={`session-badge session-badge--${session.deliveryMode}`}>
          {deliveryModeLabel(session.deliveryMode)}
        </span>
        {isFull && <span className="session-badge session-badge--full">Full</span>}
        {isLowSpots && (
          <span className="session-badge session-badge--low-spots">
            Only {spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} left!
          </span>
        )}
      </div>

      <h3 className="session-card__title">{session.title}</h3>
      <p className="session-card__description">{session.description}</p>

      <div className="session-card__meta">
        <div className="meta-item">
          <span className="meta-label">Date</span>
          <span className="meta-value">{formatDate(session.date)}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Time</span>
          <span className="meta-value">{formatTime(session.date)}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Location</span>
          <span className="meta-value">{session.location}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Capacity</span>
          <span className="meta-value">
            {session.registered} / {session.capacity} registered
            {session.waitlisted > 0 && (
              <span className="waitlisted-count"> · {session.waitlisted} waitlisted</span>
            )}
            {!isFull && (
              <span className="spots-left">
                {' '}
                ({spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} left)
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="session-card__registration">
        {formError && (
          <p className="session-card__error" role="alert">
            {formError}
          </p>
        )}
        {successMessage && (
          <p className="session-card__success" role="status">
            {successMessage}
          </p>
        )}
        {myRegistration?.status === 'confirmed' && !confirmingCancel && (
          <button
            type="button"
            className="session-card__cancel-registration"
            onClick={() => {
              setSuccessMessage(null)
              setConfirmingCancel(true)
            }}
          >
            Cancel Registration
          </button>
        )}
        {confirmingCancel && (
          <div role="alertdialog" className="session-card__confirm">
            <p>Are you sure you want to cancel your registration for {session.title}?</p>
            <div className="session-card__form-actions">
              <button
                type="button"
                className="session-card__cancel-registration"
                onClick={handleConfirmCancel}
                disabled={cancelling}
              >
                {cancelling ? 'Cancelling...' : 'Yes, cancel registration'}
              </button>
              <button
                type="button"
                className="session-card__cancel"
                onClick={() => setConfirmingCancel(false)}
              >
                Keep my registration
              </button>
            </div>
          </div>
        )}
        {myRegistration?.status === 'cancelled' && (
          <button type="button" className="session-card__cancel-registration" disabled>
            Cancelled
          </button>
        )}
        {showForm ? (
          <form className="session-card__form" onSubmit={handleSubmit}>
            <label className="session-card__field">
              <span className="session-card__field-label">Name</span>
              <input
                className="session-card__input"
                name="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label className="session-card__field">
              <span className="session-card__field-label">Email</span>
              <input
                className="session-card__input"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <div className="session-card__form-actions">
              <button type="submit" className="session-card__register" disabled={submitting}>
                {submitting ? 'Submitting...' : actionLabel}
              </button>
              <button type="button" className="session-card__cancel" onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="session-card__register"
            onClick={() => {
              setSuccessMessage(null)
              setShowForm(true)
            }}
          >
            {actionLabel}
          </button>
        )}
      </div>
    </article>
  )
}

export default TrainingSessionCard
