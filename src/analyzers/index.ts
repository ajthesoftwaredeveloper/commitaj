import fs from 'fs/promises';
import path from 'path';
import { simpleGit, SimpleGit } from 'simple-git';
import parse from 'parse-diff';

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
  private git: SimpleGit;
  private baseDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = baseDir;
    this.git = simpleGit(baseDir);
  }

  async getContext(parsedDiff: parse.File[]): Promise<RepoContext> {
    const changedFiles = parsedDiff.map(f => f.to || f.from).filter(Boolean) as string[];

    const [branch, framework, isTypeScript] = await Promise.all([
      this.git.revparse(['--abbrev-ref', 'HEAD']).catch(() => 'main'),
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
      if (deps['@remix-run/react'] || deps['@remix-run/node']) return 'Remix';
      if (deps.astro) return 'Astro';
      if (deps.nuxt) return 'Nuxt';
      if (deps.next) return 'Next.js';
      if (deps['@solidjs/core'] || deps['solid-js']) return 'SolidJS';
      if (deps.gatsby) return 'Gatsby';
      if (deps.react) return 'React';
      if (deps.vue) return 'Vue';
      if (deps.svelte) return 'Svelte';
      if (deps['@angular/core']) return 'Angular';
      if (deps.vite) return 'Vite';
      if (deps.hono) return 'Hono';
      if (deps.fastify) return 'Fastify';
      if (deps.express) return 'Express';
      if (deps['@trpc/server']) return 'tRPC';
      if (deps['drizzle-orm']) return 'Drizzle ORM';
      if (deps['@supabase/supabase-js']) return 'Supabase';
      if (deps.tailwindcss) return 'Tailwind CSS';
      if (deps.typescript) return 'TypeScript Node';
      return 'Node.js';
    } catch {
      return 'Unknown';
    }
  }



  // ── TypeScript detection ──────────────────────────────────────────────────

  private async isTypeScriptProject(): Promise<boolean> {
    try {
      await fs.access(path.join(this.baseDir, 'tsconfig.json'));
      return true;
    } catch {
      return false;
    }
  }
}
