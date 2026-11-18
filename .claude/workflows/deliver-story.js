export const meta = {
  name: 'deliver-story',
  description:
    'Deliver one WorkshopHub story end-to-end and unattended: kickoff, SPDD analysis and canvas, one TDD loop per Operation, sensors, sync and finish',
  whenToUse:
    'Run with args { storyId: "WH-9" } (or just "WH-9") to take one Trello story to an open pull request. Resumes a story already under way.',
  phases: [
    {
      title: 'kickoff',
      detail: 'find existing work, or kickoff: card to In Progress, story file, branch',
    },
    {
      title: 'spdd',
      detail:
        'analysis and canvas (if missing), then test-writer → RED check → implementer → GREEN check per Operation',
    },
    {
      title: 'sensor',
      detail: 'sensor-and-fix: format-check, lint, typecheck, test (max 3 fix rounds)',
    },
    { title: 'finish', detail: 'spdd-sync the canvas with the code, then finish-dev' },
  ],
}

// --- Parameters -------------------------------------------------------------

const rawStoryId = typeof args === 'string' ? args : args && args.storyId
if (typeof rawStoryId !== 'string' || !/^(wh-)?\d+$/i.test(rawStoryId.trim())) {
  throw new Error('deliver-story needs args { storyId: "WH-<n>" }, e.g. { storyId: "WH-9" }')
}
const storyId = `WH-${rawStoryId.trim().replace(/^wh-/i, '')}`
const storyNumber = storyId.slice(3)

// --- Shared prompt text -----------------------------------------------------

// The run is unattended: questions become documented assumptions, and only
// things that cannot be decided safely stop the run.
const UNATTENDED = `
You are one step of an unattended workflow delivering ${storyId}. No navigator is watching and AskUserQuestion is not available.
- Where a command or skill would ask the navigator something, make the most reasonable choice the story and canvas support, record it as an assumption in "notes", and carry on.
- Set "blocked" to true only when the step cannot be completed safely: a hook or sensor still failing, something destructive needed (database reset, force push, deleting work), or required input missing.
- Never bypass hooks (--no-verify, HUSKY=0), never reset the database, never force-push.
- Do only this step. Do not commit, push or open a pull request unless this step says to.`

const STEP_SCHEMA = {
  type: 'object',
  properties: {
    blocked: {
      type: 'boolean',
      description: 'true only if this step could not be completed safely',
    },
    summary: { type: 'string', description: 'What was done, in one or two sentences' },
    files: {
      type: 'array',
      items: { type: 'string' },
      description: 'Repo-relative paths created or changed by this step',
    },
    notes: {
      type: 'string',
      description: 'Assumptions made, open questions, or the reason for blocking; empty if none',
    },
  },
  required: ['blocked', 'summary', 'files', 'notes'],
}

function withFields(extra) {
  return {
    ...STEP_SCHEMA,
    properties: { ...STEP_SCHEMA.properties, ...extra },
    required: [...STEP_SCHEMA.required, ...Object.keys(extra)],
  }
}

const steps = []
const assumptions = []

// Runs one agent, records its report, and halts the workflow if it is blocked,
// so a later step never builds on a failed one.
async function step(label, prompt, extraFields, opts) {
  const schema = extraFields ? withFields(extraFields) : STEP_SCHEMA
  const result = await agent(`${prompt}\n${UNATTENDED}`, { label, schema, ...(opts || {}) })
  if (!result) {
    throw new Error(`${label}: the agent was skipped or failed, so the workflow stopped here`)
  }
  steps.push({ step: label, ...result })
  if (result.notes) assumptions.push(`${label}: ${result.notes}`)
  log(`${label}: ${result.summary}`)
  if (result.blocked) {
    throw new Error(`${label} is blocked, so the workflow stopped here: ${result.notes}`)
  }
  return result
}

// --- kickoff ----------------------------------------------------------------

phase('kickoff')
const found = await step(
  'find-existing-work',
  `Find out whether ${storyId} is already under way in this repo. Do not change any file.
- Run git fetch, then look for a local or remote branch matching ^wh-${storyNumber}-.
- Look for a story file stories/wh-${storyNumber}-*.md, an analysis spdd/analysis/${storyId}-*-[Analysis]-*.md and a canvas spdd/prompt/${storyId}-*.md (use the newest of each).
- If a branch exists, check it out (git checkout <branch>; if only remote, git checkout -t origin/<branch>). Uncommitted changes to CLAUDE.md or under .claude/ are workflow tooling: carry them along and leave them alone. If there are other uncommitted changes that do not belong to this story, set "blocked" to true instead.
Leave a field empty ("") when that thing does not exist.`,
  {
    branch: { type: 'string', description: 'Existing branch now checked out, or ""' },
    storyFile: { type: 'string', description: 'Repo-relative story file path, or ""' },
    analysisFile: { type: 'string', description: 'Repo-relative analysis path, or ""' },
    canvasFile: { type: 'string', description: 'Repo-relative canvas path, or ""' },
  },
  { effort: 'low' }
)

let branch = found.branch
let storyFile = found.storyFile
if (!branch || !storyFile) {
  const kickoff = await step(
    'kickoff',
    `Follow .claude/commands/kickoff.md for ${storyId}. Skip its clarification question to the navigator: record any clarifications as assumptions in the story file's Clarifications section instead.
Report the branch you ended on and the story file you saved under stories/.`,
    {
      branch: { type: 'string', description: 'Branch checked out at the end of kickoff' },
      storyFile: { type: 'string', description: 'Repo-relative path of the saved story file' },
    }
  )
  branch = kickoff.branch
  storyFile = kickoff.storyFile
} else {
  log(`Resuming ${storyId} on ${branch}`)
}

// --- spdd -------------------------------------------------------------------

phase('spdd')
let analysisFile = found.analysisFile
if (!analysisFile) {
  const analysis = await step(
    'spdd-analysis',
    `Run /spdd-analysis @${storyFile}
You are on branch ${branch}. Do not continue into /spdd-reasons-canvas; the next agent does that.
List every requirement ambiguity you surfaced, and the assumption you made for it, in "notes".`,
    { analysisFile: { type: 'string', description: 'Path of the file saved under spdd/analysis/' } }
  )
  analysisFile = analysis.analysisFile
}

let canvasFile = found.canvasFile
if (!canvasFile) {
  const canvas = await step(
    'spdd-reasons-canvas',
    `Run /spdd-reasons-canvas @${analysisFile}
Story: ${storyFile}. Use ${storyId} as the ticket key in the file name.
Save the canvas and stop. Do not implement it.
Write Operations so each test-driven slice is its own numbered Operation that names its test files and its tests, and mark any Operation that is applied directly (no tests, e.g. a schema change) or that only verifies.
List every decision you made without a navigator under a "Decisions to review" item in Requirements.
The canvas must pass scripts/reasons-lint.sh.`,
    { canvasFile: { type: 'string', description: 'Path of the file saved under spdd/prompt/' } }
  )
  canvasFile = canvas.canvasFile
}

const OPERATION_SCHEMA = {
  type: 'object',
  properties: {
    operations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'integer' },
          title: { type: 'string', description: 'The Operation heading, verbatim' },
          kind: { type: 'string', enum: ['slice', 'direct', 'verify'] },
          done: { type: 'boolean', description: 'true if already implemented on this branch' },
          evidence: { type: 'string', description: 'Why it counts as done or not done' },
        },
        required: ['number', 'title', 'kind', 'done', 'evidence'],
      },
    },
  },
  required: ['operations'],
}

const plan = await agent(
  `Read the canvas ${canvasFile} (## Operations) on branch ${branch}. Do not change any file.
List every Operation in order. kind: "slice" if it is test-driven (it names tests to write), "direct" if the canvas says it is applied directly without tests, "verify" if it only runs checks.
done: for a slice, true only if every test file it names exists and those tests pass (run them with \`cd api && pnpm exec jest <files>\`); for a direct Operation, true if its change is already in the code or schema; a verify Operation is never done.`,
  { label: 'plan-operations', schema: OPERATION_SCHEMA, effort: 'low' }
)
if (!plan) throw new Error('plan-operations failed, so the workflow stopped here')
const pending = plan.operations.filter((op) => !op.done && op.kind !== 'verify')
log(
  `Operations: ${plan.operations.length}, already done: ${plan.operations.filter((op) => op.done).length}, to do: ${
    pending.map((op) => op.number).join(', ') || 'none'
  }`
)

function packet(op) {
  const others = plan.operations
    .filter((o) => o.number !== op.number)
    .map((o) => `${o.number} (${o.title})`)
    .join('; ')
  return `Story ${storyId}, branch ${branch}.
Current slice: Operation ${op.number} of the REASONS canvas ${canvasFile}: "${op.title}".
Read the canvas's Requirements (its "Decisions to review" are accepted as written), Entities, Approach, Structure, Norms, Safeguards and the whole of Operation ${op.number}. Story: ${storyFile}.
Out of scope, do NOT do these: every other Operation (${others}).`
}

const RED_SCHEMA = {
  type: 'object',
  properties: {
    verdict: {
      type: 'string',
      enum: ['red', 'already-green', 'wrong-reason'],
      description:
        'red: right reason; already-green: new tests pass and the slice text says the behaviour already holds; wrong-reason: anything else',
    },
    reason: { type: 'string', description: 'Why, citing the failure output' },
    failureOutput: {
      type: 'string',
      description: 'The failing test names and their assertion or error lines',
    },
    totals: { type: 'string', description: 'Test Suites / Tests totals line' },
  },
  required: ['verdict', 'reason', 'failureOutput', 'totals'],
}

const GREEN_SCHEMA = {
  type: 'object',
  properties: {
    green: {
      type: 'boolean',
      description: 'true only if make test, make lint and make typecheck all pass',
    },
    failureOutput: { type: 'string', description: 'Failing output, empty if green' },
    totals: { type: 'string', description: 'Test Suites / Tests totals line' },
  },
  required: ['green', 'failureOutput', 'totals'],
}

function checkRed(op, tests) {
  return agent(
    `Check RED for Operation ${op.number} of ${canvasFile} ("${op.title}") on branch ${branch}. Do not change any file.
Run \`make test\`. The new or changed test files for this slice are: ${tests.files.join(', ')}.
Judge it as the project's tdd skill step 4 describes (.claude/skills/tdd/SKILL.md):
- "red" when every failure is in those files, every other test passes, and each new test fails on an assertion about the missing behaviour or its suite fails only because a module or export this slice creates does not exist yet.
- "already-green" when the new tests pass and the canvas's text for this Operation says the behaviour is already in place.
- "wrong-reason" otherwise: a typo, a wrong import path to an existing module, a broken fixture, unrelated tests now failing, or new tests passing without the canvas saying so.`,
    { label: `red-check-${op.number}`, schema: RED_SCHEMA, effort: 'low' }
  )
}

function checkGreen(op) {
  return agent(
    `Check GREEN after Operation ${op.number} of ${canvasFile} on branch ${branch}. Do not change any file.
Run \`make test\`, \`make lint\` and \`make typecheck\`. green is true only if all three pass.`,
    { label: `green-check-${op.number}`, schema: GREEN_SCHEMA, effort: 'low' }
  )
}

const TESTS_FIELDS = {
  itNames: { type: 'array', items: { type: 'string' }, description: 'Every it() name written' },
}

for (const op of pending) {
  if (op.kind === 'direct') {
    await step(
      `direct-${op.number}`,
      `${packet(op)}
This Operation is applied directly, without tests, as the canvas says. Apply exactly what it describes and run its completion check.`
    )
    continue
  }

  // RED
  let tests = await step(
    `test-writer-${op.number}`,
    `${packet(op)}
Write the failing tests this Operation names, in the files it names. Write no implementation. Report the files, every it() name and your assumptions.`,
    TESTS_FIELDS,
    { agentType: 'test-writer' }
  )
  let red = await checkRed(op, tests)
  if (!red) throw new Error(`red-check-${op.number} failed, so the workflow stopped here`)
  if (red.verdict === 'wrong-reason') {
    log(
      `Operation ${op.number}: RED for the wrong reason, sending back to test-writer once: ${red.reason}`
    )
    tests = await step(
      `test-writer-${op.number}-retry`,
      `${packet(op)}
Your tests for this Operation fail for the wrong reason. Fix the tests (not the implementation):
${red.reason}
Failure output:
${red.failureOutput}`,
      TESTS_FIELDS,
      { agentType: 'test-writer' }
    )
    red = await checkRed(op, tests)
    if (!red || red.verdict === 'wrong-reason') {
      throw new Error(
        `Operation ${op.number}: still RED for the wrong reason after one retry, so the workflow stopped here: ${red ? red.reason : 'red check failed'}`
      )
    }
  }
  steps.push({ step: `red-check-${op.number}`, ...red })
  log(`Operation ${op.number}: ${red.verdict} (${red.totals})`)
  if (red.verdict === 'already-green') {
    assumptions.push(`Operation ${op.number}: tests passed at RED; ${red.reason}`)
    continue
  }

  // GREEN
  const implementPrompt = `${packet(op)}
Failing tests (the acceptance gate, do not edit them): ${tests.files.join(', ')}
Failing it() names: ${tests.itNames.join(' | ')}
Failure output from make test:
${red.failureOutput}
Make them pass with a proper implementation, following the canvas. Done is make test, make lint and make typecheck all clean.`
  await step(`implementer-${op.number}`, implementPrompt, null, { agentType: 'implementer' })
  let green = await checkGreen(op)
  if (!green) throw new Error(`green-check-${op.number} failed, so the workflow stopped here`)
  if (!green.green) {
    log(`Operation ${op.number}: not green, sending back to implementer once`)
    await step(
      `implementer-${op.number}-retry`,
      `${implementPrompt}
Your implementation is not green yet. Output:
${green.failureOutput}`,
      null,
      { agentType: 'implementer' }
    )
    green = await checkGreen(op)
    if (!green || !green.green) {
      throw new Error(
        `Operation ${op.number}: still not green after one send-back, so the workflow stopped here: ${green ? green.failureOutput : 'green check failed'}`
      )
    }
  }
  steps.push({ step: `green-check-${op.number}`, ...green })
  log(`Operation ${op.number}: green (${green.totals})`)
}

// --- sensor -----------------------------------------------------------------

phase('sensor')
const sensor = await step(
  'sensor-and-fix',
  `Run /sensor-and-fix (.claude/commands/sensor-and-fix.md) for the ${storyId} change on branch ${branch}.
Where it would ask the navigator about a test that looks wrong, do not change the test: set "blocked" to true and explain.
Set "blocked" to true if any sensor is still failing when the fix budget runs out, and put the failing output in "notes".`,
  { green: { type: 'boolean', description: 'true only if every sensor passed on the final run' } }
)
if (!sensor.green) {
  throw new Error(
    `sensor-and-fix did not end green, so the workflow stopped before finish: ${sensor.notes}`
  )
}

// --- finish -----------------------------------------------------------------

phase('finish')
await step(
  'spdd-sync',
  `Run /spdd-sync @${canvasFile}
Bring the canvas in line with the code as it now stands on branch ${branch}, including any fixes made by sensor-and-fix.
The canvas must still pass scripts/reasons-lint.sh.`
)

const finish = await step(
  'finish-dev',
  `Follow .claude/commands/finish-dev.md for ${storyId} on branch ${branch}.
Story: ${storyFile}. Canvas: ${canvasFile}.
Do not commit uncommitted changes to CLAUDE.md or under .claude/: they are workflow tooling, not part of this story.
Include an "Assumptions" section in the pull request body listing these decisions made without a navigator:
${assumptions.map((a) => `- ${a}`).join('\n') || '- none'}`,
  {
    prUrl: { type: 'string', description: 'Pull request URL' },
    cardList: { type: 'string', description: 'Trello list the card is in at the end' },
  }
)

return {
  storyId,
  branch,
  canvasFile,
  prUrl: finish.prUrl,
  cardList: finish.cardList,
  assumptions,
  steps,
}
