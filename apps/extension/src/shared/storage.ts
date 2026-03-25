/**
 * Chrome storage wrapper for extension settings.
 * Uses chrome.storage.sync so settings persist across devices.
 */

import { DEFAULT_SEMANTIC_BUDGET, type PaktLayerProfileId } from '@sriinnu/pakt';

const PROFILE_IDS: readonly PaktLayerProfileId[] = [
  'structure',
  'standard',
  'tokenizer',
  'semantic',
];

interface LegacyExtensionSettings {
  layerStructural?: boolean;
  layerDictionary?: boolean;
}

export interface ExtensionSettings {
  /** Selected compression profile */
  compressionProfileId: PaktLayerProfileId;
  /** Positive budget required when the semantic profile is selected */
  semanticBudget: number;
  /** Auto-compress pasted content */
  autoCompress: boolean;
  /** Theme: 'system' | 'dark' | 'light' */
  theme: 'system' | 'dark' | 'light';
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  compressionProfileId: 'standard',
  semanticBudget: DEFAULT_SEMANTIC_BUDGET,
  autoCompress: false,
  theme: 'dark',
};

function isProfileId(value: unknown): value is PaktLayerProfileId {
  return typeof value === 'string' && PROFILE_IDS.includes(value as PaktLayerProfileId);
}

function normalizeSettings(
  raw: Partial<ExtensionSettings> & LegacyExtensionSettings,
): ExtensionSettings {
  const semanticBudget =
    Number.isInteger(raw.semanticBudget) && (raw.semanticBudget ?? 0) > 0
      ? (raw.semanticBudget as number)
      : DEFAULT_SETTINGS.semanticBudget;

  let compressionProfileId = DEFAULT_SETTINGS.compressionProfileId;
  if (isProfileId(raw.compressionProfileId)) {
    compressionProfileId = raw.compressionProfileId;
  } else if (raw.layerStructural === true && raw.layerDictionary === false) {
    compressionProfileId = 'structure';
  }

  return {
    compressionProfileId,
    semanticBudget,
    autoCompress:
      typeof raw.autoCompress === 'boolean' ? raw.autoCompress : DEFAULT_SETTINGS.autoCompress,
    theme:
      raw.theme === 'system' || raw.theme === 'light' || raw.theme === 'dark'
        ? raw.theme
        : DEFAULT_SETTINGS.theme,
  };
}

/**
 * Get current extension settings from chrome.storage.sync.
 * Falls back to defaults for any missing keys and migrates legacy L1/L2 flags.
 */
export async function getSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      {
        ...DEFAULT_SETTINGS,
        layerStructural: true,
        layerDictionary: true,
      },
      (items) => {
        resolve(normalizeSettings(items as Partial<ExtensionSettings> & LegacyExtensionSettings));
      },
    );
  });
}

/**
 * Save settings to chrome.storage.sync.
 */
export async function saveSettings(partial: Partial<ExtensionSettings>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set(partial, () => {
      resolve();
    });
  });
}

/**
 * Listen for settings changes.
 * Calls the callback whenever any supported setting is updated.
 */
export function onSettingsChange(
  callback: (changes: Partial<ExtensionSettings>) => void,
): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'sync') return;

    const updated: Partial<ExtensionSettings> = {};
    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULT_SETTINGS) {
        (updated as Record<string, unknown>)[key] = change.newValue;
      }
    }

    if (Object.keys(updated).length > 0) {
      callback(updated);
    }
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
