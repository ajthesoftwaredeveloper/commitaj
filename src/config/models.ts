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
 * Falls back to heuristic detection for unknown models.
 */
export function getModelCapability(modelId: string): ModelCapability {
  if (MODEL_REGISTRY[modelId]) {
    return MODEL_REGISTRY[modelId];
  }

  // Heuristic fallback for user-provided custom models
  const isThinking = /thinking|reasoning|o1|o3|r1/.test(modelId);
  const isSmall = /1\.2b|2b|3b/.test(modelId);

  return {
    isThinking,
    isSmall,
    maxDiff: isSmall ? 4000 : 12000,
    maxTokens: 1500,
    label: modelId,
    isFree: modelId.endsWith(':free'),
  };
}

/** Ordered list of presets for the ConfigWizard UI */
export const MODEL_PRESETS = Object.entries(MODEL_REGISTRY).map(([id, cap]) => ({
  id,
  label: cap.label,
}));
