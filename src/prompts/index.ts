import { RepoContext } from '../analyzers/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT — injected as the "system" role for the LLM
// ─────────────────────────────────────────────────────────────────────────────
export const SYSTEM_PROMPT = `You are a Staff Software Engineer and Git historian at a top-tier tech company.
Your singular job is to write world-class git commit messages that instantly communicate:
  1. WHAT changed (the technical action)
  2. WHY it changed (the motivation/rationale)
  3. HOW it impacts the system (scope and effect)

ABSOLUTE RULES — violating any of these is UNACCEPTABLE:
- NEVER write vague messages: "update code", "fix bug", "improve things", "misc changes", "wip"
- NEVER start with "This commit", "I", "We", or passive voice
- ALWAYS use imperative mood: "Add", "Fix", "Remove", "Refactor", "Extract", "Implement"
- ALWAYS be specific: name the function, component, module, or behavior that changed
- NEVER exceed 72 characters on the first line (the subject line)
- You MUST return ONLY valid JSON matching the requested schema. No markdown, no backticks, no explanation outside the JSON.
- Every commit message string returned in the suggestions list MUST be fully-formed and ready-to-use.

Your output will be directly used as the git commit message. Make it count.`;

// ─────────────────────────────────────────────────────────────────────────────
// ANTI-PATTERNS — shown to model to prevent bad outputs
// ─────────────────────────────────────────────────────────────────────────────
const ANTI_PATTERNS = `
FORBIDDEN — These are examples of BAD commit messages. NEVER produce these:
✗ "fix bug"
✗ "update files"  
✗ "refactor code"
✗ "improve performance"
✗ "add feature"
✗ "changes"
✗ "wip"
✗ "misc"
✗ feat(auth): update auth  ← too vague, what about auth?
✗ fix(ui): fix ui bug       ← what bug? where? what behavior?`;

// ─────────────────────────────────────────────────────────────────────────────
// CONVENTIONAL COMMITS PROMPT
// ─────────────────────────────────────────────────────────────────────────────
export const CONVENTIONAL_COMMIT_PROMPT = `
TASK: Generate EXACTLY 2 distinct Conventional Commit message suggestions for the provided git diff.
Each suggestion must be a single string representing a complete, ready-to-use commit message.

The suggestions must be:
- Option 1 (Short & Punchy): A concise, single-line Conventional Commit message capped at a maximum of 80 characters.
  Format: \`<type>(<scope>): <imperative verb> <specific description>\`
  types: feat | fix | refactor | perf | test | docs | chore | ci | build | style | revert
- Option 2 (Long & Detailed): A comprehensive Conventional Commit message featuring an explanatory subject line (max 80 chars, same format as Option 1) and a structured body (separated by a blank line) containing bullet points outlining the changes and motivations.

PROJECT CONTEXT:
- Framework: {framework}
- Branch: {branch}  
- Change Category: {category}
- Affected Modules: {affectedModules}
- TypeScript: {isTypeScript}
- Includes Tests: {hasTests}

STEP 1 — ANALYZE:
Read the diff carefully. Identify changed functions, files, and modules. 
Construct 2 different semantic angles/options for the change.

STEP 2 — FORMAT RULES for each suggestion string:
- Option 1 must be strictly a single line (no newlines) with a maximum of 80 characters.
- Option 2 must be multi-line: a subject line, followed by a blank line, followed by bullet points.
- Use literal \`\\n\` characters for newlines inside the JSON strings.

${ANTI_PATTERNS}

POSITIVE EXAMPLES (study these patterns):
{
  "suggestions": [
    "feat(auth): implement JWT refresh token rotation",
    "feat(auth): implement JWT refresh token rotation\\n\\n- Replace single-use refresh tokens with sliding window rotation\\n- Add token blacklist check on each refresh to prevent replay attacks\\n- Expose refreshToken() helper on AuthService for use in interceptors"
  ]
}

OUTPUT JSON (return ONLY this, no other text):
{
  "suggestions": [
    "<Option 1: Short & Punchy>",
    "<Option 2: Long & Detailed>"
  ]
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT RESOLVER
// ─────────────────────────────────────────────────────────────────────────────

export const getPrompt = (context: RepoContext): string => {
  const template = CONVENTIONAL_COMMIT_PROMPT;

  const affectedModules = context.affectedModules?.length
    ? context.affectedModules.join(', ')
    : context.changedFiles.map(f => f.split('/')[0]).filter(Boolean).join(', ') || 'unknown';

  return template
    .replace(/{framework}/g, context.framework)
    .replace(/{branch}/g, context.branch)
    .replace(/{category}/g, context.category)
    .replace(/{affectedModules}/g, affectedModules)
    .replace(/{isTypeScript}/g, context.isTypeScript ? 'Yes' : 'No')
    .replace(/{hasTests}/g, context.hasTests ? 'Yes' : 'No');
};
