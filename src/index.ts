import { cac } from 'cac';
import pc from 'picocolors';

import { GitService } from './git/index.js';
import { AIService } from './ai/index.js';
import { ContextEnricher } from './analyzers/index.js';
import { getConfig, setConfig, clearConfig } from './config/index.js';
import { runApp } from './ui/app.js';
import { runConfigWizard } from './ui/config-wizard.js';

declare const __VERSION__: string;

const cli = cac('commitaj');

interface CliOptions {
  dry?: boolean;
  model?: string;
  interactive?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: commit + exit helper for non-interactive mode
// ─────────────────────────────────────────────────────────────────────────────

async function nonInteractiveCommit(
  git: GitService,
  ai: AIService,
  parsedDiff: import('parse-diff').File[],
  context: import('./analyzers/index.js').RepoContext,
  history: string[],
  isDry: boolean,
): Promise<void> {
  try {
    const suggestions = await ai.generateSuggestions(parsedDiff, context, history);
    const msg = suggestions[0].message.split('\n')[0]; // Subject line only for non-interactive

    if (isDry) {
      // Machine-readable output — no colors, no decorations
      console.log(msg);
      process.exit(0);
    }

    await git.commit(msg);
    console.log(pc.green(`✔ Committed: ${pc.bold(msg)}`));
    process.exit(0);
  } catch (err: any) {
    console.error(pc.red(`✖ Error: ${err.message ?? err}`));
    process.exit(1);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
cli
  .command('init', 'Interactive setup wizard for CommitAJ')
  .action(async () => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.error(pc.red('  ✖ Error: Setup wizard requires a TTY terminal.\n'));
      process.exit(1);
    }

    try {
      await runConfigWizard();
    } catch (err: any) {
      if (err.message?.includes('cancelled')) {
        process.exit(0);
      }
      console.error(pc.red(`  ✖ Error: ${err.message ?? err}\n`));
      process.exit(1);
    }
  });

// ── Default: generate commit ──────────────────────────────────────────────────
cli
  .command('[path]', 'Generate an AI-powered commit message')
  .option('--dry', 'Dry run — preview the message without committing')
  .option('--model <model>', 'Override the AI model (OpenRouter model ID)')
  .option('--no-interactive', 'Non-interactive mode — auto-select first suggestion and commit')
  .action(async (_path: string | undefined, options: CliOptions) => {
    try {
      const isNonInteractive = options.interactive === false || !process.stdin.isTTY;

      if (!isNonInteractive && (!process.stdin.isTTY || !process.stdout.isTTY)) {
        console.error(pc.red('  ✖ Error: commitaj interactive mode requires a TTY terminal.'));
        console.error(pc.gray('  Use --no-interactive for CI/CD pipelines.\n'));
        process.exit(1);
      }

      const config = getConfig();
      const activeModel = options.model || config.model;

      // Use path arg if provided
      const git = new GitService(_path || process.cwd());

      if (!(await git.isRepo())) {
        console.error(pc.red('  ✖ Not a git repository.') + pc.gray(' Run this inside a git repo.\n'));
        process.exit(1);
      }

      const rawDiff = await git.getStagedDiff();
      if (!rawDiff) {
        if (isNonInteractive) {
          console.error('No staged changes found.');
          process.exit(1);
        }
        console.log(
          pc.yellow('  ⚠ No staged changes found.') +
          pc.gray(' Use ') + pc.cyan('git add <files>') + pc.gray(' to stage changes.\n'),
        );
        process.exit(0);
      }

      const parsedDiff = git.parseDiff(rawDiff);
      if (parsedDiff.length === 0) {
        if (isNonInteractive) {
          console.error('Staged changes contain only ignored files.');
          process.exit(1);
        }
        console.log(pc.yellow('  ⚠ Staged changes contain only ignored files (lockfiles, dist, etc.).\n'));
        process.exit(0);
      }

      const apiKey = process.env.OPENROUTER_API_KEY || config.apiKey;
      if (!apiKey) {
        console.error(
          pc.red('  ✖ OpenRouter API key not found.\n') +
          pc.gray('  Run ') + pc.cyan('commitaj init') + pc.gray(' to set it up, or set ') +
          pc.cyan('OPENROUTER_API_KEY') + pc.gray(' in your environment.\n'),
        );
        process.exit(1);
      }

      // Validate API key format (non-blocking warning)
      if (apiKey && !apiKey.startsWith('sk-or-') && !isNonInteractive) {
        console.log(
          pc.yellow('  ⚠ API key doesn\'t look like an OpenRouter key (expected sk-or-...). Proceeding anyway.\n'),
        );
      }

      // Gather context in parallel
      const enricher = new ContextEnricher(git);

      // Compute changes summary directly from parsedDiff in memory
      let additions = 0;
      let deletions = 0;
      for (const file of parsedDiff) {
        for (const chunk of file.chunks) {
          for (const change of chunk.changes) {
            if (change.type === 'add') additions++;
            else if (change.type === 'del') deletions++;
          }
        }
      }
      const summary = { files: parsedDiff.length, additions, deletions };

      const [context, history] = await Promise.all([
        enricher.getContext(parsedDiff),
        git.getCommitHistory(5),
      ]);

      const ai = new AIService(apiKey, activeModel, config.fallbackModel);

      // ── Non-interactive mode ──────────────────────────────────────────────
      if (isNonInteractive) {
        await nonInteractiveCommit(git, ai, parsedDiff, context, history, !!options.dry);
        return;
      }

      // ── Interactive mode ──────────────────────────────────────────────────
      await runApp({
        parsedDiff,
        ai,
        context,
        git,
        dry: options.dry,
        history,
        summary,
      });
    } catch (err: any) {
      console.error(pc.red(`  ✖ Unexpected error: ${err.message ?? err}\n`));
      process.exit(1);
    }
  });

// ── Config management ─────────────────────────────────────────────────────────
cli
  .command('config <action> [key] [value]', 'Manage configuration')
  .example('commitaj config set apiKey sk-or-...')
  .example('commitaj config set model openai/gpt-4o-mini')
  .example('commitaj config list')
  .action((action: string, key: string, value: string) => {
    switch (action) {
      case 'set': {
        if (!key || !value) {
          console.log(pc.red('  ✖ Usage: commitaj config set <key> <value>\n'));
          return;
        }
        setConfig(key as any, value);
        console.log(pc.green(`  ✔ Set ${pc.bold(key)} → ${pc.bold(value)}\n`));
        break;
      }
      case 'get': {
        if (!key) {
          console.log(pc.red('  ✖ Usage: commitaj config get <key>\n'));
          return;
        }
        const cfg = getConfig();
        const val = (cfg as any)[key];
        const display = key === 'apiKey' ? (val ? '****' + (val as string).slice(-4) : 'Not set') : val;
        console.log(`  ${pc.cyan(key)}: ${display ?? 'Not set'}\n`);
        break;
      }
      case 'list': {
        const cfg = getConfig();
        console.log(pc.bold(pc.cyan('\n  CommitAJ Configuration:\n')));
        Object.entries(cfg).forEach(([k, v]) => {
          const display = k === 'apiKey' ? (v ? '****' + (v as string).slice(-4) : 'Not set') : v;
          console.log(`  ${pc.cyan(k.padEnd(16))} ${String(display ?? '')}`);
        });
        console.log();
        break;
      }
      case 'reset': {
        clearConfig();
        console.log(pc.green('  ✔ Configuration reset to defaults.\n'));
        break;
      }
      default:
        console.log(pc.red(`  ✖ Unknown action "${action}". Use: set | get | list | reset\n`));
    }
  });

cli.version(__VERSION__);
cli.help();
cli.parse();
