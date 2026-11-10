import { useState, type FormEvent } from 'react'
import type { TrainingSession } from '../types'
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

    try {
      const res = await fetch(`${API_BASE}/api/training-sessions/${session.id}/registrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      })

      if (res.ok) {
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
        } else if (res.status === 409) {
          message = 'This session is full.'
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
        {!isFull &&
          (showForm ? (
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
                  {submitting ? 'Registering...' : 'Register'}
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
              onClick={() => setShowForm(true)}
            >
              Register
            </button>
          ))}
      </div>
    </article>
  )
}

export default TrainingSessionCard
