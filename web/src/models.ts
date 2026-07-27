import type { ModelInfo, EffortLevel } from './protocol';

/**
 * Curated list shown only until the server's SDK discovery probe reports the
 * account's real catalog (see `api.models()`) — discovery is authoritative and
 * replaces this list at runtime. Kept current with the model lineup; every id
 * is present in the bundled Agent SDK (@anthropic-ai/claude-agent-sdk 0.3.220),
 * whose discovery probe reports Opus 5 as the recommended default.
 */
export const FALLBACK_MODELS: ModelInfo[] = [
  { value: 'claude-opus-5', displayName: 'Claude Opus 5', description: '' },
  { value: 'claude-fable-5', displayName: 'Claude Fable 5', description: '' },
  { value: 'claude-sonnet-5', displayName: 'Claude Sonnet 5', description: '' },
  { value: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', description: '' },
];

/**
 * Explicit version pins offered *in addition* to the SDK's quick-pick aliases.
 * The SDK's aliases (`default`, `opus[1m]`, …) track the newest release; this
 * pins specific older versions the aliases don't otherwise expose — the
 * previous-generation Opus releases, both valid CLI model ids not reachable
 * via any alias.
 */
export const PINNED_MODELS: ModelInfo[] = [
  { value: 'claude-opus-4-8', displayName: 'Claude Opus 4.8', description: '' },
  { value: 'claude-opus-4-7', displayName: 'Claude Opus 4.7', description: '' },
  { value: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', description: '' },
];

const ALL_EFFORT: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Human label for an effort level — the value plus a one-word gloss. */
export const EFFORT_LABEL: Record<EffortLevel, string> = {
  low: 'Low · fastest',
  medium: 'Medium',
  high: 'High · default',
  xhigh: 'Extra high',
  max: 'Max · most thorough',
};

/**
 * A specific, intelligible label for a model — never "Default (recommended)".
 * Prefers the SDK description's model clause (which names the version and
 * context window, e.g. "Opus 4.8 with 1M context") and falls back to the
 * display name with vague decorations stripped.
 */
export function modelLabel(m: ModelInfo): string {
  const clause = m.description?.split('·')[0]?.trim();
  if (clause && /\d/.test(clause)) return clause; // names a concrete version
  const dn = m.displayName.replace(/\s*\(recommended\)\s*/i, '').trim();
  return dn || m.value;
}

/** Per-model-family effort fallback, used when the SDK didn't report levels
 *  (e.g. for explicit version pins). Mirrors the documented support matrix. */
function effortFallback(m: ModelInfo): EffortLevel[] {
  const s = `${m.value} ${m.displayName} ${m.description}`.toLowerCase();
  if (s.includes('haiku')) return []; // Haiku has no effort parameter
  if (s.includes('4-6') || s.includes('4.6')) {
    // Opus 4.6 / Sonnet 4.6: no xhigh (that's Opus 4.7+), but max is supported.
    return ['low', 'medium', 'high', 'max'];
  }
  // Fable 5 / Mythos 5 and Sonnet 5 support the full range including xhigh.
  if (
    s.includes('fable') ||
    s.includes('mythos') ||
    s.includes('sonnet-5') ||
    s.includes('sonnet 5')
  ) {
    return ALL_EFFORT;
  }
  if (s.includes('opus') || /\bdefault\b/.test(m.value) || s.includes('opus[1m]')) {
    return ALL_EFFORT; // Opus 4.8 and the opus aliases
  }
  if (s.includes('sonnet')) return ['low', 'medium', 'high', 'max'];
  return ['low', 'medium', 'high']; // unknown model: conservative subset
}

/** The effort levels selectable for a model — SDK-reported when available,
 *  else the documented fallback. Empty means effort isn't supported. */
export function effortLevelsFor(m: ModelInfo | undefined): EffortLevel[] {
  if (!m) return [];
  if (m.supportsEffort === false) return [];
  if (m.supportedEffortLevels && m.supportedEffortLevels.length > 0) {
    return m.supportedEffortLevels;
  }
  return effortFallback(m);
}

/**
 * The picker list: the SDK's account-accurate aliases first, then explicit
 * pins not already present, deduped by display label so the two Opus 4.8
 * aliases (`default` and `opus[1m]`) don't both appear. Falls back to the
 * curated list before discovery resolves.
 */
export function pickerModels(sdk: ModelInfo[]): ModelInfo[] {
  const base = sdk.length > 0 ? sdk : FALLBACK_MODELS;
  const haveValue = new Set(base.map((m) => m.value));
  const merged = [...base, ...PINNED_MODELS.filter((m) => !haveValue.has(m.value))];
  const seenLabel = new Set<string>();
  return merged.filter((m) => {
    const key = modelLabel(m);
    if (seenLabel.has(key)) return false;
    seenLabel.add(key);
    return true;
  });
}
