/**
 * Centralized registry of recommended OpenRouter models with capability metadata.
 * Used by AIService for parameter tuning and ConfigWizard for preset selection.
 */

export interface ModelCapability {
  /** Whether model performs internal reasoning/thinking before responding */
  isThinking: boolean;
  /** Whether model is ≤3B parameters (affects token limits) */
  isSmall: boolean;
  /** Recommended max diff characters to send to this model */
  maxDiff: number;
  /** Recommended max_tokens for response */
  maxTokens: number;
  /** Human-readable label for UI display */
  label: string;
  /** Whether it's free on OpenRouter */
  isFree: boolean;
}

export const MODEL_REGISTRY: Record<string, ModelCapability> = {
  'openai/gpt-oss-120b:free': {
    isThinking: true,
    isSmall: false,
    maxDiff: 30000,
    maxTokens: 800,
    label: 'GPT OSS 120B (Primary, free)',
    isFree: true,
  },
  'z-ai/glm-4.5-air:free': {
    isThinking: false,
    isSmall: false,
    maxDiff: 30000,
    maxTokens: 800,
    label: 'GLM 4.5 Air (Fallback, free)',
    isFree: true,
  },
};

/**
 * Returns capability metadata for a given model ID.
 *
 * Known models in the registry get optimized parameters.
 * Unknown / custom models get intelligent heuristic defaults so that
 * any model available on OpenRouter (free or paid) works seamlessly.
 */
export function getModelCapability(modelId: string): ModelCapability {
  if (MODEL_REGISTRY[modelId]) {
    return MODEL_REGISTRY[modelId];
  }

  // Heuristic fallback for user-provided custom models
  const lower = modelId.toLowerCase();
  const isThinking = /thinking|reasoning|o1|o3|o4|r1|r2/.test(lower);
  const isSmall = /(\b|[-/])([123])b(\b|[-/:])/.test(lower);
  const isFree = lower.endsWith(':free');

  return {
    isThinking,
    isSmall,
    maxDiff: isSmall ? 4000 : isThinking ? 30000 : 15000,
    maxTokens: isSmall ? 400 : 800,
    label: modelId,
    isFree,
  };
}

/** Ordered list of presets for the ConfigWizard UI */
export const MODEL_PRESETS = Object.entries(MODEL_REGISTRY).map(([id, cap]) => ({
  id,
  label: cap.label,
}));
