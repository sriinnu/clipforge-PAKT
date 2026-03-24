import type { PaktLayerProfile, PaktLayerProfileId, PaktOptions } from './types.js';

export const DEFAULT_SEMANTIC_BUDGET = 96;

export const PAKT_LAYER_PROFILES: readonly PaktLayerProfile[] = [
  {
    id: 'structure',
    label: 'Structure only',
    shortLabel: 'L1',
    description: 'Structural rewrite only. Closest to a TOON-like baseline and fully reversible.',
    layers: {
      structural: true,
      dictionary: false,
      tokenizerAware: false,
      semantic: false,
    },
    reversible: true,
    requiresSemanticBudget: false,
  },
  {
    id: 'standard',
    label: 'Standard',
    shortLabel: 'L1+L2',
    description: 'Structural rewrite plus dictionary aliases for repeated keys and values.',
    layers: {
      structural: true,
      dictionary: true,
      tokenizerAware: false,
      semantic: false,
    },
    reversible: true,
    requiresSemanticBudget: false,
  },
  {
    id: 'tokenizer',
    label: 'Tokenizer-aware',
    shortLabel: 'L1+L2+L3',
    description: 'Adds model-aware delimiter choices on top of standard PAKT while staying reversible.',
    layers: {
      structural: true,
      dictionary: true,
      tokenizerAware: true,
      semantic: false,
    },
    reversible: true,
    requiresSemanticBudget: false,
  },
  {
    id: 'semantic',
    label: 'Semantic',
    shortLabel: 'L1+L2+L3+L4',
    description: 'Adds budgeted semantic compression. This can save more tokens, but it is lossy.',
    layers: {
      structural: true,
      dictionary: true,
      tokenizerAware: true,
      semantic: true,
    },
    reversible: false,
    requiresSemanticBudget: true,
  },
] as const;

const PROFILE_MAP = new Map<PaktLayerProfileId, PaktLayerProfile>(
  PAKT_LAYER_PROFILES.map((profile) => [profile.id, profile]),
);

export function getPaktLayerProfile(profileId: PaktLayerProfileId): PaktLayerProfile {
  const profile = PROFILE_MAP.get(profileId);
  if (!profile) {
    throw new Error(`Unknown PAKT layer profile: ${profileId}`);
  }
  return profile;
}

export function createProfiledPaktOptions(
  profileId: PaktLayerProfileId,
  options: Omit<PaktOptions, 'layers'> = {},
): PaktOptions {
  const profile = getPaktLayerProfile(profileId);
  const next: PaktOptions = {
    ...options,
    layers: { ...profile.layers },
  };

  if (profile.requiresSemanticBudget) {
    if (!Number.isInteger(options.semanticBudget) || (options.semanticBudget ?? 0) <= 0) {
      throw new Error('Semantic profile requires a positive semantic budget');
    }
  }

  return next;
}
