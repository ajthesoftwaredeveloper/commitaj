import * as p from '@clack/prompts';
import pc from 'picocolors';
import { AIService, CommitSuggestion } from '../ai/index.js';
import { RepoContext } from '../analyzers/index.js';
import { GitService } from '../git/index.js';
import parse from 'parse-diff';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AppOptions {
  parsedDiff: parse.File[];
  ai: AIService;
  context: RepoContext;
  git: GitService;
  dry?: boolean;
  history: string[];
  summary: { additions: number; deletions: number; files: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Commit and exit (or dry-run preview) — shared by all commit paths */
async function commitAndExit(
  git: GitService,
  message: string,
  isDry: boolean,
): Promise<void> {
  if (isDry) {
    p.log.info(pc.bold(pc.yellow('⚡ Dry run — message:')));
    console.log(pc.gray(message));
    p.outro(pc.gray('No commit was made.'));
    process.exit(0);
  }

  try {
    await git.commit(message);
    const [subject, ...body] = message.split('\n');
    p.outro(pc.green(`✔ Committed: ${pc.bold(subject)}`));
    if (body.filter(l => l.trim()).length > 0) {
      console.log(pc.gray(body.join('\n')));
    }
    process.exit(0);
  } catch (err: any) {
    p.log.error(`Commit failed: ${err.message ?? err}`);
    process.exit(1);
  }
}

/** Format the first line of each suggestion for the select menu */
function formatSuggestionLabel(s: CommitSuggestion, idx: number): string {
  const subject = s.message.split('\n')[0];
  const hasBody = s.message.includes('\n');
  const label = idx === 0 ? 'Short & Punchy' : 'Detailed';
  return `${pc.bold(`Option ${idx + 1}`)} ${pc.gray(`(${label})`)} — ${subject}${hasBody ? pc.dim(' [+body]') : ''}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main interactive flow
// ─────────────────────────────────────────────────────────────────────────────

export async function runApp(options: AppOptions): Promise<void> {
  const { parsedDiff, ai, context, git, dry, history, summary } = options;

  // ── Header ──────────────────────────────────────────────────────────────
  p.intro(
    pc.bold(pc.cyan('commitaj')) + pc.gray(' — AI Commit Generator'),
  );

  const statsLine =
    `${summary.files} file${summary.files !== 1 ? 's' : ''} changed ` +
    `${pc.green(`+${summary.additions}`)} ${pc.red(`-${summary.deletions}`)}`;

  const contextLine = [
    context.framework,
    pc.magenta(context.branch),
    context.category !== 'unknown' ? pc.yellow(`[${context.category}]`) : '',
    context.affectedModules.length > 0
      ? pc.gray(`(${context.affectedModules.slice(0, 4).join(', ')})`)
      : '',
  ].filter(Boolean).join(pc.gray(' · '));

  p.log.info(`${statsLine}\n  ${contextLine}`);

  if (dry) {
    p.log.warn(pc.yellow('DRY RUN — no commit will be made'));
  }

  // ── Generate loop (supports retry) ──────────────────────────────────────
  let shouldRetry = true;

  while (shouldRetry) {
    shouldRetry = false;

    // Generate suggestions with spinner
    const s = p.spinner();
    s.start(
      `Analyzing${context.affectedModules.length > 0 ? ` ${context.affectedModules.slice(0, 3).join(', ')}` : ' changes'} and crafting commit suggestions... ${pc.gray(`(${ai.getModelName()})`)}`,
    );

    let suggestions: CommitSuggestion[];
    try {
      suggestions = await ai.generateSuggestions(parsedDiff, context, history);
      s.stop(pc.green('Suggestions ready!'));
    } catch (err: any) {
      s.stop(pc.red('Generation failed.'));
      p.log.error(err.message ?? 'Unknown error');
      p.outro(pc.gray('Run commitaj again to retry.'));
      process.exit(1);
    }

    // ── Select suggestion ─────────────────────────────────────────────────
    const selected = await p.select({
      message: 'Select a commit message:',
      options: suggestions.map((s, i) => ({
        value: i,
        label: formatSuggestionLabel(s, i),
      })),
    });

    if (p.isCancel(selected)) {
      p.cancel('Commit cancelled.');
      process.exit(0);
    }

    const selectedMsg = suggestions[selected as number].message;

    // ── Preview the full message ──────────────────────────────────────────
    const [subject, ...bodyLines] = selectedMsg.split('\n');
    p.log.step(pc.bold(pc.green(subject)));
    const bodyText = bodyLines.filter(l => l.trim()).join('\n');
    if (bodyText) {
      console.log(pc.gray(`  ${bodyText.split('\n').join('\n  ')}`));
    }

    // ── Action menu ───────────────────────────────────────────────────────
    const hasBody = selectedMsg.includes('\n');

    const actionOptions: Array<{ value: string; label: string; hint?: string }> = [];

    if (hasBody) {
      actionOptions.push({
        value: 'commit-full',
        label: dry ? '📋  Preview full message' : '🚀  Commit with full message (subject + body)',
      });
      actionOptions.push({
        value: 'commit-subject',
        label: dry ? '📋  Preview subject line only' : '🚀  Commit with subject line only',
      });
    } else {
      actionOptions.push({
        value: 'commit-full',
        label: dry ? '📋  Preview message' : '🚀  Commit with this message',
      });
    }

    actionOptions.push(
      { value: 'edit', label: '✏️   Edit message manually' },
      { value: 'edit-external', label: '📝  Edit in external editor' },
      { value: 'retry', label: '🔄  Regenerate suggestions' },
      { value: 'cancel', label: '❌  Cancel' },
    );

    const action = await p.select({
      message: 'What would you like to do?',
      options: actionOptions,
    });

    if (p.isCancel(action)) {
      p.cancel('Commit cancelled.');
      process.exit(0);
    }

    switch (action as string) {
      case 'commit-full':
        await commitAndExit(git, selectedMsg, !!dry);
        break;

      case 'commit-subject':
        await commitAndExit(git, selectedMsg.split('\n')[0], !!dry);
        break;

      case 'edit': {
        const edited = await p.text({
          message: 'Edit the commit message:',
          initialValue: selectedMsg.split('\n')[0],
          placeholder: 'Enter commit message...',
          validate: (val) => {
            if (!val.trim()) return 'Commit message cannot be empty.';
          },
        });

        if (p.isCancel(edited)) {
          p.cancel('Edit cancelled.');
          process.exit(0);
        }

        await commitAndExit(git, (edited as string).trim(), !!dry);
        break;
      }

      case 'edit-external': {
        try {
          const edited = await git.editMessageInEditor(selectedMsg);
          if (!edited) {
            p.log.warn('Commit message is empty. Commit aborted.');
            process.exit(1);
          }
          await commitAndExit(git, edited, !!dry);
        } catch (err: any) {
          p.log.error(`Editor failed: ${err.message ?? err}`);
          process.exit(1);
        }
        break;
      }

      case 'retry':
        shouldRetry = true;
        break;

      case 'cancel':
        p.cancel('Commit cancelled.');
        process.exit(0);
        break;
    }
  }
}
