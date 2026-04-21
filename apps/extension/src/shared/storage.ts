/**
 * Chrome storage wrapper for extension settings.
 * Uses chrome.storage.sync so settings persist across devices.
 */

import { DEFAULT_SEMANTIC_BUDGET, type PaktLayerProfileId } from '@sriinnu/pakt';
import { type FontPreset, isFontPreset } from '../popup/fonts';

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
  /** Theme: 'system' | 'dark' | 'light' | 'oled' */
  theme: 'system' | 'dark' | 'light' | 'oled';
  /** Font preset: 'modern' | 'classic' | 'rounded' | 'system' */
  fontPreset: FontPreset;
  /** Target model — feeds L3's merge-savings gate and `countTokens()`. */
  targetModel: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  compressionProfileId: 'standard',
  semanticBudget: DEFAULT_SEMANTIC_BUDGET,
  autoCompress: false,
  theme: 'dark',
  fontPreset: 'modern',
  targetModel: 'gpt-4o',
};

function isProfileId(value: unknown): value is PaktLayerProfileId {
  return typeof value === 'string' && PROFILE_IDS.includes(value as PaktLayerProfileId);
}

function isTheme(value: unknown): value is ExtensionSettings['theme'] {
  return value === 'system' || value === 'light' || value === 'dark' || value === 'oled';
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
    theme: isTheme(raw.theme) ? raw.theme : DEFAULT_SETTINGS.theme,
    fontPreset: isFontPreset(raw.fontPreset) ? raw.fontPreset : DEFAULT_SETTINGS.fontPreset,
    targetModel:
      typeof raw.targetModel === 'string' && raw.targetModel.length > 0
        ? raw.targetModel
        : DEFAULT_SETTINGS.targetModel,
  };
}

function normalizeSettingsChange(raw: Record<string, unknown>): Partial<ExtensionSettings> {
  const updated: Partial<ExtensionSettings> = {};

  if (isProfileId(raw.compressionProfileId)) {
    updated.compressionProfileId = raw.compressionProfileId;
  }

  if (Number.isInteger(raw.semanticBudget) && (raw.semanticBudget as number) > 0) {
    updated.semanticBudget = raw.semanticBudget as number;
  }

  if (typeof raw.autoCompress === 'boolean') {
    updated.autoCompress = raw.autoCompress;
  }

  if (isTheme(raw.theme)) {
    updated.theme = raw.theme;
  }

  if (isFontPreset(raw.fontPreset)) {
    updated.fontPreset = raw.fontPreset;
  }

  if (typeof raw.targetModel === 'string' && raw.targetModel.length > 0) {
    updated.targetModel = raw.targetModel;
  }

  return updated;
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

    const rawUpdated: Record<string, unknown> = {};
    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULT_SETTINGS) {
        rawUpdated[key] = change.newValue;
      }
    }

    const updated = normalizeSettingsChange(rawUpdated);
    if (Object.keys(updated).length > 0) {
      callback(updated);
    }
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
