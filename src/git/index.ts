import { execFile } from 'child_process';
import { promisify } from 'util';
import parse from 'parse-diff';
import path from 'path';
import { spawn } from 'child_process';
import fs from 'fs/promises';

const execFileAsync = promisify(execFile);

// ─────────────────────────────────────────────────────────────────────────────
// Lightweight git helper — replaces simple-git with child_process.execFile
// ─────────────────────────────────────────────────────────────────────────────

async function git(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024, // 10 MB — handles large diffs
    });
    return stdout;
  } catch (err: any) {
    // Preserve stderr message for actionable errors
    const message = err.stderr?.trim() || err.message || 'Unknown git error';
    throw new Error(`git ${args[0]} failed: ${message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Noise patterns — files to exclude from AI analysis
// ─────────────────────────────────────────────────────────────────────────────

const NOISE_PATTERNS = [
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'composer.lock',
  'Gemfile.lock',
  'dist/',
  'build/',
  'vendor/',
  '.next/',
  '.nuxt/',
  '.output/',
  'node_modules/',
  'coverage/',
  '.turbo/',
  // Images/Video/Audio
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.mp4', '.mov', '.mp3',
  // Fonts
  '.woff', '.woff2', '.eot', '.ttf', '.otf',
  // Archives
  '.zip', '.tar.gz', '.tgz', '.rar', '.gz',
  // Executables/Build artifacts
  '.exe', '.dll', '.so', '.dylib', '.map',
];

// ─────────────────────────────────────────────────────────────────────────────
// GitService
// ─────────────────────────────────────────────────────────────────────────────

export class GitService {
  private baseDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = baseDir;
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  async isRepo(): Promise<boolean> {
    try {
      await git(['rev-parse', '--is-inside-work-tree'], this.baseDir);
      return true;
    } catch {
      return false;
    }
  }

  async getStagedDiff(): Promise<string> {
    return git(['diff', '--cached'], this.baseDir);
  }

  async getStagedFiles(): Promise<string[]> {
    const output = await git(['diff', '--cached', '--name-only'], this.baseDir);
    return output.trim().split('\n').filter(Boolean);
  }

  async commit(message: string): Promise<void> {
    await git(['commit', '-m', message], this.baseDir);
  }

  async getCommitHistory(count: number = 5): Promise<string[]> {
    try {
      const output = await git(
        ['log', `--format=%s%n%b%n---COMMIT_SEP---`, `-n`, String(count), '--'],
        this.baseDir,
      );
      return output
        .split('---COMMIT_SEP---')
        .map(s => s.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async getBranchName(): Promise<string> {
    try {
      // Fast path: read .git/HEAD directly
      const headPath = path.join(this.baseDir, '.git', 'HEAD');
      const headContent = await fs.readFile(headPath, 'utf-8');
      const match = headContent.match(/^ref:\s+(refs\/heads\/\S+)/);
      if (match && match[1]) {
        return match[1].replace('refs/heads/', '').trim();
      }
      return headContent.trim().slice(0, 7); // Short SHA if detached HEAD
    } catch {
      // Fallback: use git command
      try {
        const output = await git(['rev-parse', '--abbrev-ref', 'HEAD'], this.baseDir);
        return output.trim();
      } catch {
        return 'main';
      }
    }
  }

  async getRepoName(): Promise<string> {
    try {
      const output = await git(['remote', 'get-url', 'origin'], this.baseDir);
      const url = output.trim();
      const name = url.split('/').pop()?.replace(/\.git$/, '');
      if (name) return name;
    } catch {
      // ignore — no remote configured
    }
    return path.basename(this.baseDir);
  }

  parseDiff(diff: string): parse.File[] {
    const fileDiffs = diff.split(/^diff --git /m);
    const filtered = fileDiffs.filter(fileDiff => {
      if (!fileDiff.trim()) return false;
      const firstLine = fileDiff.split('\n')[0] || '';
      const isNoise = NOISE_PATTERNS.some(pattern => firstLine.includes(pattern));
      return !isNoise;
    });

    const cleanDiff = filtered.map(chunk => 'diff --git ' + chunk).join('');
    return parse(cleanDiff);
  }

  /**
   * Format parsed diff for the AI — strips context lines (unchanged lines)
   * to maximize signal-to-token ratio. Only additions (+) and deletions (-) are kept.
   */
  formatParsedDiff(parsedDiff: parse.File[]): string {
    return parsedDiff
      .map(file => {
        const lines: string[] = [];

        for (const chunk of file.chunks) {
          // Include the hunk header for position context
          lines.push(`@@ ${chunk.content.trim()} @@`);
          for (const change of chunk.changes) {
            if (change.type === 'add') lines.push(`+${change.content}`);
            else if (change.type === 'del') lines.push(`-${change.content}`);
            // context (normal) lines are intentionally omitted to save tokens
          }
        }

        const header = `=== ${file.to ?? file.from ?? 'unknown'} ===`;
        return lines.length ? `${header}\n${lines.join('\n')}` : null;
      })
      .filter(Boolean)
      .join('\n\n');
  }

  async getEditor(): Promise<string> {
    try {
      const output = await git(['config', 'core.editor'], this.baseDir);
      const editor = output.trim();
      if (editor) return editor;
    } catch {
      // ignore
    }
    const envEditor = process.env.VISUAL || process.env.EDITOR;
    if (envEditor) {
      return envEditor;
    }
    return process.platform === 'win32' ? 'notepad' : 'nano';
  }

  async editMessageInEditor(initialMessage: string): Promise<string> {
    const editor = await this.getEditor();
    const tempFile = path.join(this.baseDir, '.git', 'COMMIT_EDITMSG');
    
    await fs.mkdir(path.dirname(tempFile), { recursive: true });
    await fs.writeFile(tempFile, initialMessage, 'utf8');
    
    return new Promise((resolve, reject) => {
      const parts = editor.split(/\s+/);
      const bin = parts[0];
      const args = [...parts.slice(1), tempFile];
      
      const child = spawn(bin, args, { stdio: 'inherit', shell: true });
      
      child.on('exit', async (code) => {
        if (code !== 0) {
          reject(new Error(`Editor exited with code ${code}`));
          return;
        }
        try {
          const edited = await fs.readFile(tempFile, 'utf8');
          await fs.unlink(tempFile).catch(() => {});
          resolve(edited.trim());
        } catch (err) {
          reject(err);
        }
      });
      
      child.on('error', (err) => {
        reject(err);
      });
    });
  }
}
