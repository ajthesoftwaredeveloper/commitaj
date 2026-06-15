import { simpleGit, SimpleGit } from 'simple-git';
import parse from 'parse-diff';
import path from 'path';
import { spawn } from 'child_process';
import fs from 'fs/promises';

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
  '.exe', '.dll', '.so', '.dylib', '.map'
];

export class GitService {
  private git: SimpleGit;
  private baseDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = baseDir;
    this.git = simpleGit(baseDir);
  }

  async isRepo(): Promise<boolean> {
    try {
      return await this.git.checkIsRepo();
    } catch {
      return false;
    }
  }

  async getStagedDiff(): Promise<string> {
    return this.git.diff(['--cached']);
  }

  async getStagedFiles(): Promise<string[]> {
    const status = await this.git.status();
    return status.staged;
  }

  async commit(message: string): Promise<void> {
    await this.git.commit(message);
  }

  async getCommitHistory(count: number = 5): Promise<string[]> {
    try {
      const log = await this.git.log({ maxCount: count });
      return log.all.map(entry =>
        entry.body ? `${entry.message}\n${entry.body}` : entry.message
      );
    } catch {
      return [];
    }
  }

  async getFileSummary(): Promise<{ additions: number; deletions: number; files: number }> {
    try {
      const diff = await this.git.diff(['--cached', '--shortstat']);
      // Use number-only regex to be locale-agnostic
      const filesMatch = diff.match(/(\d+)\s+files?\s+changed/);
      const addMatch = diff.match(/(\d+)\s+insertions?\(\+\)/);
      const delMatch = diff.match(/(\d+)\s+deletions?\(-\)/);
      return {
        files: parseInt(filesMatch?.[1] ?? '0'),
        additions: parseInt(addMatch?.[1] ?? '0'),
        deletions: parseInt(delMatch?.[1] ?? '0'),
      };
    } catch {
      return { additions: 0, deletions: 0, files: 0 };
    }
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

  /**
   * Returns the repository name from the git remote origin URL,
   * falling back to the directory basename.
   */
  async getRepoName(): Promise<string> {
    try {
      const remotes = await this.git.getRemotes(true);
      const origin = remotes.find(r => r.name === 'origin');
      if (origin?.refs?.fetch) {
        const name = origin.refs.fetch.split('/').pop()?.replace(/\.git$/, '');
        if (name) return name;
      }
    } catch {
      // ignore
    }
    return path.basename(this.baseDir);
  }

  async getEditor(): Promise<string> {
    try {
      const gitEditor = await this.git.getConfig('core.editor');
      if (gitEditor.value) {
        return gitEditor.value;
      }
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
