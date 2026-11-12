export interface TrainingSession {
  id: number
  title: string
  description: string
  date: string
  capacity: number
  registered: number
  waitlisted: number
  location: string
  deliveryMode: string
  status: string
  createdAt: string
  updatedAt: string
}

export interface Registration {
  id: number
  sessionId: number
  name: string
  email: string
  status: string
  createdAt: string
}

export type RegistrationStatus = 'confirmed' | 'waitlisted' | 'cancelled'

export interface WaitlistResponse {
  status: 'waitlisted'
  position: number
  id: number
}

export interface MyRegistration {
  registrationId: number
  status: RegistrationStatus
  sessionCreatedAt: string
}

export interface CancelRegistrationResponse {
  status: 'cancelled'
}
