// ─────────────────────────────────────────────────────────────────────────────
// OpenRouter API Client — zero-dependency replacement for the openai SDK
// Uses Node 18+ built-in fetch() with timeout and retry support.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  response_format?: { type: string };
}

export interface ChatCompletionChoice {
  message: { role: string; content: string };
  finish_reason: string;
  index: number;
}

export interface ChatCompletionResponse {
  id: string;
  choices: ChatCompletionChoice[];
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: { message: string; code?: number };
}

// ─────────────────────────────────────────────────────────────────────────────

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const REQUEST_TIMEOUT_MS = 45_000; // 45 seconds

/**
 * Send a chat completion request to the OpenRouter API.
 *
 * Features:
 *  - 45-second request timeout via AbortSignal
 *  - Automatic retry with linear backoff for 429 (rate limit) and 5xx errors
 *  - Typed request / response
 */
export async function chatCompletion(
  apiKey: string,
  request: ChatCompletionRequest,
  maxRetries = 2,
): Promise<ChatCompletionResponse> {
  const url = `${OPENROUTER_BASE}/chat/completions`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/ajthesoftwaredeveloper/commitaj',
          'X-Title': 'commitaj',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.ok) {
        const data = (await res.json()) as ChatCompletionResponse;
        if (data.error) {
          throw new Error(data.error.message);
        }
        return data;
      }

      // Retry on rate-limit or server errors
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        await sleep(1000 * (attempt + 1));
        continue;
      }

      // Non-retryable error — surface it
      const errorBody = await res.text().catch(() => '');
      let errorMessage = `OpenRouter API error ${res.status}`;
      try {
        const parsed = JSON.parse(errorBody);
        if (parsed?.error?.message) errorMessage = parsed.error.message;
      } catch {
        if (errorBody) errorMessage += `: ${errorBody}`;
      }
      throw new Error(errorMessage);
    } catch (err: any) {
      clearTimeout(timeout);

      if (err.name === 'AbortError') {
        throw new Error(
          'OpenRouter request timed out after 45 seconds. Check your network or try again.',
        );
      }

      // If we have retries left and it's a network-level error, retry
      if (attempt < maxRetries && !err.message?.startsWith('OpenRouter')) {
        await sleep(1000 * (attempt + 1));
        continue;
      }

      throw err;
    }
  }

  // Should be unreachable, but TypeScript requires a return
  throw new Error('Unexpected: all retries exhausted.');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
