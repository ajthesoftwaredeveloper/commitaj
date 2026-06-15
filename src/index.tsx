import { cac } from 'cac';
import React from 'react';
import { render } from 'ink';
import chalk from 'chalk';

import { GitService } from './git/index.js';
import { AIService } from './ai/index.js';
import { ContextEnricher } from './analyzers/index.js';
import { getConfig, setConfig, clearConfig } from './config/index.js';
import App from './ui/App.js';
import ConfigWizard from './ui/ConfigWizard.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const cli = cac('commitaj');

interface CliOptions {
  dry?: boolean;
  model?: string;
}

// ── Init ──────────────────────────────────────────────────────────────────────
cli
  .command('init', 'Interactive setup wizard for CommitAJ')
  .action(async () => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.error(chalk.red('  ✖ Error: Setup wizard requires a TTY terminal.\n'));
      process.exit(1);
    }

    const { waitUntilExit, unmount } = render(<ConfigWizard />);
    
    const cleanup = () => {
      unmount();
      process.exit(130);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    try {
      await waitUntilExit();
    } catch (err) {
      process.exit(1);
    } finally {
      process.off('SIGINT', cleanup);
      process.off('SIGTERM', cleanup);
    }
  });

// ── Default: generate commit ──────────────────────────────────────────────────
cli
  .command('[path]', 'Generate an AI-powered commit message')
  .option('--dry', 'Dry run — preview the message without committing')
  .option('--model <model>', 'Override the AI model (OpenRouter model ID)')
  .action(async (_path: string | undefined, options: CliOptions) => {
    try {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error(chalk.red('  ✖ Error: commitaj interactive interface requires a TTY terminal.\n'));
        process.exit(1);
      }

      const config = getConfig();
      const activeModel = options.model || config.model;

      console.log(chalk.bold.cyan('\n  commitaj') + chalk.gray(' — AI Commit Generator\n'));

      // Use path arg if provided (was silently ignored before)
      const git = new GitService(_path || process.cwd());

      if (!(await git.isRepo())) {
        console.log(chalk.red('  ✖ Not a git repository.') + chalk.gray(' Run this inside a git repo.\n'));
        process.exit(1);
      }

      const rawDiff = await git.getStagedDiff();
      if (!rawDiff) {
        console.log(
          chalk.yellow('  ⚠ No staged changes found.') +
          chalk.gray(' Use ') + chalk.cyan('git add <files>') + chalk.gray(' to stage changes.\n')
        );
        process.exit(0);
      }

      const parsedDiff = git.parseDiff(rawDiff);
      if (parsedDiff.length === 0) {
        console.log(chalk.yellow('  ⚠ Staged changes contain only ignored files (lockfiles, dist, etc.).\n'));
        process.exit(0);
      }

      const apiKey = process.env.OPENROUTER_API_KEY || config.apiKey;
      if (!apiKey) {
        console.log(
          chalk.red('  ✖ OpenRouter API key not found.\n') +
          chalk.gray('  Run ') + chalk.cyan('commitaj init') + chalk.gray(' to set it up, or set ') +
          chalk.cyan('OPENROUTER_API_KEY') + chalk.gray(' in your environment.\n')
        );
        process.exit(1);
      }

      // Gather context in parallel
      const enricher = new ContextEnricher(_path || process.cwd());
      
      // Compute changes summary directly from parsedDiff in memory to save a git subprocess call
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
      const summary = {
        files: parsedDiff.length,
        additions,
        deletions,
      };

      const [context, history] = await Promise.all([
        enricher.getContext(parsedDiff),
        git.getCommitHistory(5),
      ]);

      const ai = new AIService(apiKey, activeModel, config.fallbackModel);

      const { waitUntilExit, unmount } = render(
        <App
          parsedDiff={parsedDiff}
          ai={ai}
          context={context}
          git={git}
          dry={options.dry}
          history={history}
          summary={summary}
          onSuccess={async (msg, action) => {
            unmount();
            if (action === 'dry') {
              console.log(chalk.bold.yellow('\n  ⚡ Dry run — message:\n') + chalk.gray(msg) + '\n');
              process.exit(0);
            }

            try {
              await git.commit(msg);
              console.log(chalk.green(`\n  ✔ Committed: ${chalk.bold(msg.split('\n')[0])}\n`));
              if (msg.includes('\n')) {
                console.log(chalk.gray(msg.split('\n').slice(1).join('\n')) + '\n');
              }
              process.exit(0);
            } catch (err: any) {
              console.log(chalk.red(`\n  ✖ Commit failed: ${err.message ?? err}\n`));
              process.exit(1);
            }
          }}
          onEditExternal={async (msg) => {
            unmount();
            const edited = await git.editMessageInEditor(msg);
            if (!edited) {
              console.log(chalk.yellow('\n  ⚠ Commit message is empty. Commit aborted.\n'));
              process.exit(1);
            }

            if (options.dry) {
              console.log(chalk.bold.yellow('\n  ⚡ Dry run — message:\n') + chalk.gray(edited) + '\n');
              process.exit(0);
            }

            try {
              await git.commit(edited);
              console.log(chalk.green(`\n  ✔ Committed: ${chalk.bold(edited.split('\n')[0])}\n`));
              if (edited.includes('\n')) {
                console.log(chalk.gray(edited.split('\n').slice(1).join('\n')) + '\n');
              }
              process.exit(0);
            } catch (err: any) {
              console.log(chalk.red(`\n  ✖ Commit failed: ${err.message ?? err}\n`));
              process.exit(1);
            }
          }}
        />
      );

      const cleanup = () => {
        unmount();
        process.exit(130);
      };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      try {
        await waitUntilExit();
      } catch (err) {
        process.exit(1);
      } finally {
        process.off('SIGINT', cleanup);
        process.off('SIGTERM', cleanup);
      }
    } catch (err: any) {
      console.log(chalk.red(`  ✖ Unexpected error: ${err.message ?? err}\n`));
      process.exit(1);
    }
  });

// ── Config management ─────────────────────────────────────────────────────────
cli
  .command('config <action> [key] [value]', 'Manage configuration')
  .example('commitaj config set apiKey sk-or-...')
  .example('commitaj config set model openai/gpt-oss-120b:free')
  .example('commitaj config list')
  .action((action: string, key: string, value: string) => {
    switch (action) {
      case 'set': {
        if (!key || !value) {
          console.log(chalk.red('  ✖ Usage: commitaj config set <key> <value>\n'));
          return;
        }
        setConfig(key as any, value);
        console.log(chalk.green(`  ✔ Set ${chalk.bold(key)} → ${chalk.bold(value)}\n`));
        break;
      }
      case 'get': {
        if (!key) {
          console.log(chalk.red('  ✖ Usage: commitaj config get <key>\n'));
          return;
        }
        const cfg = getConfig();
        const val = (cfg as any)[key];
        const display = key === 'apiKey' ? (val ? '****' + (val as string).slice(-4) : 'Not set') : val;
        console.log(`  ${chalk.cyan(key)}: ${chalk.white(display ?? 'Not set')}\n`);
        break;
      }
      case 'list': {
        const cfg = getConfig();
        console.log(chalk.bold.cyan('\n  CommitAJ Configuration:\n'));
        Object.entries(cfg).forEach(([k, v]) => {
          const display = k === 'apiKey' ? (v ? '****' + (v as string).slice(-4) : 'Not set') : v;
          console.log(`  ${chalk.cyan(k.padEnd(16))} ${chalk.white(String(display ?? ''))}`);
        });
        console.log();
        break;
      }
      case 'reset': {
        clearConfig();
        console.log(chalk.green('  ✔ Configuration reset to defaults.\n'));
        break;
      }
      default:
        console.log(chalk.red(`  ✖ Unknown action "${action}". Use: set | get | list | reset\n`));
    }
  });

cli.version(pkg.version);
cli.help();
cli.parse();
