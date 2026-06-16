import * as p from '@clack/prompts';
import pc from 'picocolors';
import { setConfig } from '../config/index.js';
import { MODEL_PRESETS } from '../config/models.js';

// ─────────────────────────────────────────────────────────────────────────────
// ConfigWizard — interactive setup using @clack/prompts
// ─────────────────────────────────────────────────────────────────────────────

export async function runConfigWizard(): Promise<void> {
  p.intro(pc.bold(pc.cyan('CommitAJ Setup')));

  // ── Step 1: API Key ─────────────────────────────────────────────────────
  p.log.info(
    `Get your free API key at ${pc.bold(pc.cyan('openrouter.ai/keys'))}\n` +
    pc.dim('  It\'s free — no credit card needed for free models.'),
  );

  const apiKey = await p.text({
    message: 'Enter your OpenRouter API key:',
    placeholder: 'sk-or-v1-... (press Enter to skip if using env var)',
    validate: (val) => {
      if (val.length > 0 && val.trim().length <= 8) {
        return 'Key looks too short — double-check it.';
      }
    },
  });

  if (p.isCancel(apiKey)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  // ── Step 2: Model Selection ─────────────────────────────────────────────
  const modelChoice = await p.select({
    message: 'Choose the AI model:',
    options: [
      ...MODEL_PRESETS.map(m => ({
        value: m.id,
        label: m.label,
      })),
      {
        value: '__custom__',
        label: '🔧  Enter custom OpenRouter model ID...',
        hint: 'Any model from openrouter.ai/models',
      },
    ],
  });

  if (p.isCancel(modelChoice)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  let finalModel = modelChoice as string;

  if (finalModel === '__custom__') {
    const customModel = await p.text({
      message: 'Enter the OpenRouter model ID:',
      placeholder: 'e.g. openai/gpt-4o-mini or anthropic/claude-sonnet-4',
      validate: (val) => {
        if (!val.trim()) return 'Model ID is required.';
        if (!val.includes('/')) return 'Model ID should be in format: provider/model-name';
      },
    });

    if (p.isCancel(customModel)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }

    finalModel = (customModel as string).trim();
  }

  // ── Save Configuration ──────────────────────────────────────────────────
  const trimmedKey = (apiKey as string).trim();
  if (trimmedKey.length > 0) {
    setConfig('apiKey', trimmedKey);
  }
  setConfig('model', finalModel);

  // ── Summary ─────────────────────────────────────────────────────────────
  p.note(
    [
      `API Key:  ${trimmedKey ? '****' + trimmedKey.slice(-4) : pc.dim('Not configured (using environment)')}`,
      `Model:    ${pc.cyan(finalModel)}`,
    ].join('\n'),
    'Configuration saved',
  );

  p.outro(
    `Run ${pc.bold(pc.cyan('commitaj'))} in any git repo to generate your first commit!`,
  );
}
