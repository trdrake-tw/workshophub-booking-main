export const meta = {
  name: 'deliver-story',
  description:
    'Deliver one WorkshopHub story end-to-end: kickoff, SPDD (analysis, canvas, generate), sensors, sync and finish',
  whenToUse:
    'Run with args { storyId: "WH-9" } (or just "WH-9") to take one Trello story from kickoff to finish-dev.',
  phases: [
    { title: 'kickoff', detail: 'Trello card to In Progress, story file, wh-{n}-{desc} branch' },
    { title: 'spdd', detail: 'spdd-analysis, then spdd-reasons-canvas, then spdd-generate' },
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

// --- Shared prompt text -----------------------------------------------------

// Workflow agents run unattended, so a command that would normally ask the
// navigator has to stop and report instead of guessing.
const UNATTENDED = `
You are one step of an unattended workflow delivering ${storyId}; no navigator is available to answer questions.
- Where the command would ask the navigator something, do not guess and do not use AskUserQuestion: finish what is safe, set "blocked" to true and put the question in "notes".
- Do only this step. The other steps belong to other agents.
- Do not commit, push or open a pull request unless the command you are following says to.`

const STEP_SCHEMA = {
  type: 'object',
  properties: {
    blocked: { type: 'boolean', description: 'true if this step could not be completed' },
    summary: { type: 'string', description: 'What was done, in one or two sentences' },
    files: {
      type: 'array',
      items: { type: 'string' },
      description: 'Repo-relative paths created or changed by this step',
    },
    notes: {
      type: 'string',
      description: 'Open questions, assumptions or the reason for blocking; empty if none',
    },
  },
  required: ['blocked', 'summary', 'files', 'notes'],
}

const steps = []

// Runs one agent, records its report and halts the workflow if it is blocked,
// so a later step never builds on a failed one.
async function step(label, prompt, extraProperties) {
  const schema = extraProperties
    ? {
        ...STEP_SCHEMA,
        properties: { ...STEP_SCHEMA.properties, ...extraProperties },
        required: [...STEP_SCHEMA.required, ...Object.keys(extraProperties)],
      }
    : STEP_SCHEMA
  const result = await agent(`${prompt}\n${UNATTENDED}`, { label, schema })
  if (!result) {
    throw new Error(`${label}: the agent was skipped or failed, so the workflow stopped here`)
  }
  steps.push({ step: label, ...result })
  log(`${label}: ${result.summary}`)
  if (result.blocked) {
    throw new Error(`${label} is blocked, so the workflow stopped here: ${result.notes}`)
  }
  return result
}

// --- kickoff ----------------------------------------------------------------

phase('kickoff')
const kickoff = await step(
  'kickoff',
  `Follow .claude/commands/kickoff.md for ${storyId}.
Report the branch you ended on and the story file you saved under stories/.`,
  {
    branch: { type: 'string', description: 'Branch checked out at the end of kickoff' },
    storyFile: { type: 'string', description: 'Repo-relative path of the saved story file' },
  }
)

// --- spdd -------------------------------------------------------------------

phase('spdd')
const analysis = await step(
  'spdd-analysis',
  `Run /spdd-analysis @${kickoff.storyFile}
You should be on branch ${kickoff.branch}. Do not continue into /spdd-reasons-canvas; the next agent does that.
List every requirement ambiguity you surfaced in "notes".`,
  { analysisFile: { type: 'string', description: 'Path of the file saved under spdd/analysis/' } }
)

const canvas = await step(
  'spdd-reasons-canvas',
  `Run /spdd-reasons-canvas @${analysis.analysisFile}
Story: ${kickoff.storyFile}. Use ${storyId} as the ticket key in the file name.
Save the canvas and stop. Do not implement it; the next agent does that.
The canvas must pass scripts/reasons-lint.sh.
Open points carried over from the analysis: ${analysis.notes || 'none'}`,
  { canvasFile: { type: 'string', description: 'Path of the file saved under spdd/prompt/' } }
)

const generated = await step(
  'spdd-generate',
  `Run /spdd-generate @${canvas.canvasFile}
Story: ${kickoff.storyFile}. Implement the canvas's Operations on branch ${kickoff.branch}.
Do not run the full sensor pass; the next agent does that.`
)

// --- sensor -----------------------------------------------------------------

phase('sensor')
const sensor = await step(
  'sensor-and-fix',
  `Run /sensor-and-fix (.claude/commands/sensor-and-fix.md) for the ${storyId} change.
Files changed by the implementation: ${generated.files.join(', ') || 'see git status'}.
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
  `Run /spdd-sync @${canvas.canvasFile}
Bring the canvas in line with the code as it now stands on branch ${kickoff.branch}, including any fixes made by sensor-and-fix.
The canvas must still pass scripts/reasons-lint.sh.`
)

await step(
  'finish-dev',
  `Run /finish-dev for ${storyId} on branch ${kickoff.branch}.
Story: ${kickoff.storyFile}. Canvas: ${canvas.canvasFile}.
If there is no finish-dev command or skill in this project or your user settings, do not improvise one: set "blocked" to true and say so in "notes".`
)

return { storyId, branch: kickoff.branch, steps }
