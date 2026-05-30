import OpenAI from 'openai';
import { getPrompt, SYSTEM_PROMPT } from '../prompts/index.js';
import { RepoContext } from '../analyzers/index.js';
import { formatSmartDiff } from '../utils/ai-helpers.js';
import { getModelCapability } from '../config/models.js';
import chalk from 'chalk';
import parse from 'parse-diff';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A structured commit suggestion holding a complete ready-to-use commit message.
 */
export interface CommitSuggestion {
  /** Complete commit message (subject line + optional body) */
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// AIService
// ─────────────────────────────────────────────────────────────────────────────

export class AIService {
  private openai: OpenAI;
  private model: string;
  private fallbackModel?: string;

  constructor(
    apiKey: string,
    model: string ,
    fallbackModel?: string
  ) {
    this.openai = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/ajthesoftwaredeveloper/commitaj',
        'X-Title': 'commitaj',
      },
    });
    this.model = model;
    this.fallbackModel = fallbackModel;
  }

  getModelName(): string {
    return this.model;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Main public method — returns 2 distinct suggestions
  // ───────────────────────────────────────────────────────────────────────────

  async generateSuggestions(
    parsedDiff: parse.File[],
    context: RepoContext,
    history: string[]
  ): Promise<CommitSuggestion[]> {
    const cap = getModelCapability(this.model);
    const smartDiff = formatSmartDiff(parsedDiff, cap.maxDiff);
    const prompt = this._buildPrompt(context, history);

    try {
      return await this._getSuggestions(this.model, prompt, smartDiff);
    } catch (error) {
      if (this.fallbackModel) {
        process.stdout.write(
          chalk.yellow(`\n  ⚠ Primary model failed. Retrying with fallback: ${this.fallbackModel}...\n`)
        );
        const fallbackCap = getModelCapability(this.fallbackModel);
        const fallbackSmartDiff = formatSmartDiff(parsedDiff, fallbackCap.maxDiff);
        return await this._getSuggestions(this.fallbackModel, prompt, fallbackSmartDiff);
      }
      throw error;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Prompt builder — assembles all context sections
  // ───────────────────────────────────────────────────────────────────────────

  private _buildPrompt(context: RepoContext, history: string[]): string {
    const basePrompt = getPrompt(context);

    const historySection =
      history.length > 0
        ? `\nRECENT COMMIT HISTORY (match this project's commit style and tone):\n${history
            .slice(0, 5)
            .map(h => `  • ${h}`)
            .join('\n')}`
        : '';

    const fileList = context.changedFiles.slice(0, 20).join(', ');
    const extraContext = `\nCHANGED FILES: ${fileList || 'unknown'}`;

    return `${basePrompt}${historySection}${extraContext}`;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Core AI call — returns parsed CommitSuggestion[]
  // ───────────────────────────────────────────────────────────────────────────

  private async _getSuggestions(
    model: string,
    prompt: string,
    diff: string
  ): Promise<CommitSuggestion[]> {
    const cap = getModelCapability(model);

    const response = await this.openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${prompt}\n\nGIT DIFF TO ANALYZE:\n\`\`\`diff\n${diff}\n\`\`\`` },
      ],
      temperature: cap.isThinking ? 0.05 : 0.20,
      max_tokens: cap.maxTokens,
      response_format: { type: 'json_object' },
      ...(cap.isThinking
        ? { top_p: 0.1, frequency_penalty: 0.1 }
        : { top_p: 0.9, frequency_penalty: 0.0 }),
    } as any);

    const raw = response.choices[0]?.message?.content ?? '{}';
    return this._parseResponse(raw);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Response parser — handles new suggestions array format
  // ───────────────────────────────────────────────────────────────────────────

  private _parseResponse(raw: string): CommitSuggestion[] {
    // Extract the JSON object even if the model wrapped it in backticks
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : raw;

    let parsed: any = {};
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Last resort fallback: line extraction
      const lines = raw
        .split('\n')
        .map(l => l.replace(/^[-*•"'\s]+|["'\s]+$/g, '').trim())
        .filter(l => l.length > 5);
      
      if (lines.length > 0) {
        const suggestions: CommitSuggestion[] = [];
        const count = lines.length;
        for (let i = 0; i < 2; i++) {
          const line = lines[i % count];
          suggestions.push({ message: line });
        }
        return suggestions;
      }
      throw new Error('AI returned unparseable output. Please retry.');
    }

    // Fail-safe: Detect double-encoded JSON in first option item and promote it
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0) {
      const firstItem = parsed.suggestions[0];
      if (typeof firstItem === 'string' && (firstItem.trim().startsWith('{') || firstItem.trim().startsWith('['))) {
        try {
          const nested = JSON.parse(firstItem);
          if (nested && typeof nested === 'object' && Array.isArray(nested.suggestions)) {
            parsed = nested;
          } else if (Array.isArray(nested)) {
            parsed = { suggestions: nested };
          }
        } catch {
          // ignore
        }
      }
    }

    const suggestions: CommitSuggestion[] = [];

    // 1. Try standard suggestions array of strings
    if (Array.isArray(parsed.suggestions)) {
      for (const item of parsed.suggestions) {
        if (typeof item === 'string') {
          const cleanMsg = this._clean(item);
          if (cleanMsg) {
            suggestions.push({ message: cleanMsg });
          }
        } else if (item && typeof item === 'object') {
          const msg = item.message ?? item.detailed ?? item.short ?? item.brief ?? '';
          const cleanMsg = this._clean(msg);
          if (cleanMsg) {
            suggestions.push({ message: cleanMsg });
          }
        }
      }
    } 
    // 2. Fallback if single suggestion format returned
    else if (parsed && typeof parsed === 'object') {
      // If it returned { "short": "...", "detailed": "..." } directly
      if (parsed.detailed || parsed.short || parsed.message) {
        const msg = parsed.detailed ?? parsed.short ?? parsed.message ?? '';
        const cleanMsg = this._clean(msg);
        if (cleanMsg) {
          suggestions.push({ message: cleanMsg });
        }
      } else {
        // Try to loop through all object values
        for (const val of Object.values(parsed)) {
          if (typeof val === 'string' && val.length > 5) {
            suggestions.push({ message: this._clean(val) });
          }
        }
      }
    }

    if (suggestions.length === 0) {
      throw new Error('AI returned JSON but no valid commit messages could be extracted. Please retry.');
    }

    // Standardize to exactly 2 suggestions (replicate if fewer)
    const finalSuggestions: CommitSuggestion[] = [];
    const count = suggestions.length;
    for (let i = 0; i < 2; i++) {
      finalSuggestions.push({
        ...suggestions[i % count]
      });
    }

    return finalSuggestions;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  private _clean(text: string): string {
    let clean = text
      .replace(/\\n/g, '\n')   // unescape literal \n in JSON strings
      .replace(/^["'`]+|["'`]+$/g, '') // strip wrapping quotes
      .trim();

    // Fail-safe: recursively unwrap double-encoded JSON strings or arrays
    if ((clean.startsWith('{') && clean.endsWith('}')) || (clean.startsWith('[') && clean.endsWith(']'))) {
      try {
        const parsed = JSON.parse(clean);
        if (typeof parsed === 'string') {
          return this._clean(parsed);
        }
        if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
          return this._clean(parsed[0]);
        }
        if (parsed && typeof parsed === 'object') {
          const val = parsed.message ?? parsed.detailed ?? parsed.short ?? Object.values(parsed)[0];
          if (typeof val === 'string') {
            return this._clean(val);
          }
        }
      } catch {
        // ignore and return as-is if parsing fails
      }
    }

    return clean;
  }
}
