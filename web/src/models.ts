import type { ModelInfo } from './protocol';

/**
 * Curated list shown only until the server's SDK discovery probe reports the
 * account's real catalog (see `api.models()`). The SDK is the source of truth
 * for the quick-pick aliases; this keeps the picker non-empty before discovery
 * resolves, or if it fails entirely.
 */
export const FALLBACK_MODELS: ModelInfo[] = [
  { value: 'claude-opus-4-8', displayName: 'Claude Opus 4.8', description: 'Most capable' },
  { value: 'claude-opus-4-7', displayName: 'Claude Opus 4.7', description: 'Highly capable' },
  { value: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', description: 'Capable' },
  { value: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', description: 'Balanced' },
  {
    value: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    description: 'Fastest',
  },
];

/**
 * Explicit version pins offered *in addition* to the SDK's quick-pick aliases.
 * The SDK reports moving aliases (`default`, `opus[1m]`, …) that always track
 * the newest release; these let you lock a specific Opus version (e.g. 4.6)
 * instead. Every id here is a valid model string for the bundled CLI.
 */
export const PINNED_MODELS: ModelInfo[] = [
  { value: 'claude-opus-4-8', displayName: 'Claude Opus 4.8', description: 'Pin this exact version' },
  { value: 'claude-opus-4-7', displayName: 'Claude Opus 4.7', description: 'Pin this exact version' },
  { value: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', description: 'Pin this exact version' },
];

/**
 * The SDK's account-accurate aliases first, then any explicit version pins not
 * already present. Falls back to the curated list before discovery resolves.
 * Deduped by model id, so pins that the SDK already lists aren't doubled.
 */
export function mergeModels(sdk: ModelInfo[]): ModelInfo[] {
  const base = sdk.length > 0 ? sdk : FALLBACK_MODELS;
  const seen = new Set(base.map((m) => m.value));
  return [...base, ...PINNED_MODELS.filter((m) => !seen.has(m.value))];
}

/** Label for a model value, falling back to the raw id when it isn't known. */
export function modelLabel(models: ModelInfo[], value: string): string {
  return models.find((m) => m.value === value)?.displayName ?? value;
}
