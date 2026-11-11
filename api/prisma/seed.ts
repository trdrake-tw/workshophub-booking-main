import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding training sessions...')

  // Registrations are deleted before sessions (defensive ordering; the FK also cascades).
  await prisma.registration.deleteMany()
  await prisma.trainingSession.deleteMany()

  await prisma.trainingSession.createMany({
    data: [
      {
        title: 'AI-assisted Software Delivery Fundamentals',
        description:
          'An introduction to integrating AI tools into the software delivery lifecycle. Covers prompt engineering, AI-assisted TDD, code review automation, and responsible AI usage in engineering teams.',
        date: new Date('2026-07-15T09:00:00Z'),
        capacity: 20,
        registered: 0,
        location: 'Training Room A, Level 3',
        deliveryMode: 'in-person',
        status: 'active',
      },
      {
        title: 'TDD in Agentic Development Loop',
        description:
          'Hands-on workshop exploring test-driven development when working with AI coding agents. Learn how to write failing tests first, guide agent suggestions, and maintain a green test suite throughout the agentic loop.',
        date: new Date('2026-07-22T09:00:00Z'),
        capacity: 24,
        registered: 0,
        location: 'Virtual — Zoom',
        deliveryMode: 'online',
        status: 'active',
      },
      {
        title: 'Secure Coding with AI Assistance',
        description:
          'Identify and prevent common security vulnerabilities when using AI code generation tools. Covers OWASP Top 10 in the context of AI-assisted development, secret management, and automated security scanning.',
        date: new Date('2026-07-29T09:00:00Z'),
        capacity: 16,
        registered: 0,
        location: 'Training Room B, Level 2',
        deliveryMode: 'in-person',
        status: 'active',
      },
      {
        title: 'Engineering Practices for AI-enabled Teams',
        description:
          'Team-level practices for maintaining code quality, shared context, and delivery flow when the team uses AI coding assistants. Topics include pair prompting, AI-aware code review, and collective code ownership.',
        date: new Date('2026-08-05T09:00:00Z'),
        capacity: 20,
        registered: 0,
        location: 'Hybrid — Room C + Virtual',
        deliveryMode: 'hybrid',
        status: 'active',
      },
      {
        title: 'CI/CD and Quality Gates Workshop',
        description:
          'Design and operate CI/CD pipelines that incorporate AI-generated code safely. Covers automated test gates, lint and format checks, security scanning, and self-hosted runner setup for production simulation.',
        date: new Date('2026-08-12T09:00:00Z'),
        capacity: 20,
        registered: 0,
        location: 'Training Room A, Level 3',
        deliveryMode: 'in-person',
        status: 'active',
      },
    ],
  })

  // Purpose-made full fixture (registered === capacity) so the full-session integration
  // tests can target a dedicated session instead of mutating seeded data.
  const fullSession = await prisma.trainingSession.create({
    data: {
      title: 'Full Workshop Fixture',
      description:
        'A workshop that is already at capacity. It exists so tests can exercise the "session is full" response without mutating any other seeded session.',
      date: new Date('2026-06-24T09:00:00Z'),
      capacity: 2,
      registered: 2,
      location: 'Training Room A, Level 3',
      deliveryMode: 'in-person',
      status: 'active',
    },
  })

  await prisma.registration.create({
    data: {
      sessionId: fullSession.id,
      name: 'Fixture Attendee One',
      email: 'fixture.one@example.com',
      status: 'confirmed',
    },
  })
  await prisma.registration.create({
    data: {
      sessionId: fullSession.id,
      name: 'Fixture Attendee Two',
      email: 'fixture.two@example.com',
      status: 'confirmed',
    },
  })

  const count = await prisma.trainingSession.count()
  console.log(`Seeded ${count} training sessions.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
