import fs from 'fs/promises';
import path from 'path';
import parse from 'parse-diff';
import { GitService } from '../git/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// RepoContext — enriched project intelligence passed to the AI
// ─────────────────────────────────────────────────────────────────────────────

export interface RepoContext {
  framework: string;
  branch: string;
  changedFiles: string[];
  isTypeScript: boolean;
  hasTests: boolean;
  category: string;
  /** Top-level directories of changed files, e.g. ['src', 'tests'] */
  affectedModules: string[];
  /** Project/repo name from git remote or directory */
  repoName: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ContextEnricher
// ─────────────────────────────────────────────────────────────────────────────

export class ContextEnricher {
  private baseDir: string;
  private git: GitService;
  private cachedFramework: string | null = null;
  private cachedIsTypeScript: boolean | null = null;

  constructor(git: GitService) {
    this.baseDir = git.getBaseDir();
    this.git = git;
  }

  async getContext(parsedDiff: parse.File[]): Promise<RepoContext> {
    const changedFiles = parsedDiff.map(f => f.to || f.from).filter(Boolean) as string[];

    const [branch, framework, isTypeScript] = await Promise.all([
      this.git.getBranchName(),
      this.detectFramework(),
      this.isTypeScriptProject(),
    ]);

    const hasTests = changedFiles.some(f =>
      /\.(test|spec)\.|\/tests\/|\/test\/|__tests__/.test(f)
    );
    const affectedModules = this.getAffectedModules(changedFiles);
    const category = this.detectCategory(changedFiles);

    return {
      framework,
      branch,
      changedFiles,
      isTypeScript,
      hasTests,
      category,
      affectedModules,
      repoName: path.basename(this.baseDir),
    };
  }

  // ── Category: dominant-count logic (replaces all-or-nothing) ──────────────

  private detectCategory(files: string[]): string {
    if (files.length === 0) return 'unknown';

    const score: Record<string, number> = {
      testing: 0,
      documentation: 0,
      styling: 0,
      ui: 0,
      configuration: 0,
      feature: 0,
    };

    for (const f of files) {
      if (/\.(test|spec)\.|\/tests\/|\/test\/|__tests__/.test(f)) score.testing++;
      else if (/readme|\.md$|\/docs\//i.test(f)) score.documentation++;
      else if (/\.(css|scss|less|sass)$|tailwind/.test(f)) score.styling++;
      else if (/\.(tsx|jsx)$|\/components\/|\/pages\/|\/views\//.test(f)) score.ui++;
      else if (/package\.json|tsconfig|\.env|\.config\.|eslint|prettier/.test(f)) score.configuration++;
      else score.feature++;
    }

    // Return the category with the highest count
    return Object.entries(score).sort((a, b) => b[1] - a[1])[0][0];
  }

  // ── Affected modules: unique top-level dirs ───────────────────────────────

  private getAffectedModules(files: string[]): string[] {
    const modules = files
      .map(f => {
        const parts = f.split('/');
        // For files like 'src/auth/service.ts' → 'auth' (second segment if first is 'src')
        if (parts.length >= 2 && (parts[0] === 'src' || parts[0] === 'app' || parts[0] === 'lib')) {
          return parts[1];
        }
        return parts[0];
      })
      .filter(Boolean);
    return [...new Set(modules)];
  }

  // ── Framework detection ───────────────────────────────────────────────────

  private async detectFramework(): Promise<string> {
    if (this.cachedFramework !== null) {
      return this.cachedFramework;
    }
    try {
      const pkgPath = path.join(this.baseDir, 'package.json');
      const content = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      const deps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      // Order matters — most specific first
      let framework = 'Node.js';
      if (deps['@remix-run/react'] || deps['@remix-run/node']) framework = 'Remix';
      else if (deps.astro) framework = 'Astro';
      else if (deps.nuxt) framework = 'Nuxt';
      else if (deps.next) framework = 'Next.js';
      else if (deps['@solidjs/core'] || deps['solid-js']) framework = 'SolidJS';
      else if (deps.gatsby) framework = 'Gatsby';
      else if (deps.react) framework = 'React';
      else if (deps.vue) framework = 'Vue';
      else if (deps.svelte) framework = 'Svelte';
      else if (deps['@angular/core']) framework = 'Angular';
      else if (deps.vite) framework = 'Vite';
      else if (deps.hono) framework = 'Hono';
      else if (deps.fastify) framework = 'Fastify';
      else if (deps.express) framework = 'Express';
      else if (deps['@trpc/server']) framework = 'tRPC';
      else if (deps['drizzle-orm']) framework = 'Drizzle ORM';
      else if (deps['@supabase/supabase-js']) framework = 'Supabase';
      else if (deps.tailwindcss) framework = 'Tailwind CSS';
      else if (deps.typescript) framework = 'TypeScript Node';

      this.cachedFramework = framework;
      return framework;
    } catch {
      this.cachedFramework = 'Unknown';
      return 'Unknown';
    }
  }

  // ── TypeScript detection ──────────────────────────────────────────────────

  private async isTypeScriptProject(): Promise<boolean> {
    if (this.cachedIsTypeScript !== null) {
      return this.cachedIsTypeScript;
    }
    try {
      await fs.access(path.join(this.baseDir, 'tsconfig.json'));
      this.cachedIsTypeScript = true;
      return true;
    } catch {
      this.cachedIsTypeScript = false;
      return false;
    }
  }
}
