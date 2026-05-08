/**
 * Chrome storage wrapper for extension settings.
 * Uses chrome.storage.sync so settings persist across devices.
 */

import {
  type CacheTarget,
  DEFAULT_SEMANTIC_BUDGET,
  type PIIMode,
  type PaktLayerProfileId,
} from '@sriinnu/pakt';
import { type FontPreset, isFontPreset } from '../popup/fonts';

const PROFILE_IDS: readonly PaktLayerProfileId[] = [
  'structure',
  'standard',
  'tokenizer',
  'semantic',
];

const PII_MODES: readonly PIIMode[] = ['off', 'flag', 'redact'];

const CACHE_TARGETS: readonly CacheTarget[] = ['anthropic', 'bedrock', 'openai', 'google'];

function isCacheTarget(value: unknown): value is CacheTarget {
  return typeof value === 'string' && CACHE_TARGETS.includes(value as CacheTarget);
}

interface LegacyExtensionSettings {
  layerStructural?: boolean;
  layerDictionary?: boolean;
}

export interface ExtensionSettings {
  /** Selected compression profile */
  compressionProfileId: PaktLayerProfileId;
  /** Positive budget required when the semantic profile is selected */
  semanticBudget: number;
  /** Auto-compress the active tab’s text the moment the popup opens */
  autoCompress: boolean;
  /**
   * Auto-compress text the user pastes into a supported LLM input box.
   *
   * Disabled by default — paste interception is a noticeable behaviour change
   * and we do not want to surprise users with an automatically rewritten
   * prompt the first time they install the extension.
   */
  autoCompressOnPaste: boolean;
  /**
   * Hostnames the content script is allowed to act on.
   *
   * The content script is already gated by `manifest.content_scripts.matches`
   * — this list lets the user opt out of individual sites without editing the
   * manifest. Empty array means “all sites that the manifest matches”.
   */
  siteWhitelist: string[];
  /**
   * Personally-identifiable information strategy.
   *
   * - `'off'`    — no scanning (default; keeps the popup behavior backwards-compatible)
   * - `'flag'`   — lossless scan that adds a `@warning pii` header so the LLM
   *                knows the prompt contains sensitive data
   * - `'redact'` — substitutes detected PII with placeholders before the
   *                compressed text leaves the browser. Keeps a reversible
   *                mapping in memory only.
   */
  piiMode: PIIMode;
  /** Theme: 'system' | 'dark' | 'light' | 'oled' */
  theme: 'system' | 'dark' | 'light' | 'oled';
  /** Font preset: 'modern' | 'classic' | 'rounded' | 'system' */
  fontPreset: FontPreset;
  /** Target model — feeds L3's merge-savings gate and `countTokens()`. */
  targetModel: string;
  /**
   * Provider cache target. When set, `compress()` returns a
   * `cacheBreakpoint` hint with the byte offset where provider
   * `cache_control` should be placed and the recommended TTL.
   * Bedrock supports 1h, Anthropic defaults to 5min, OpenAI/Google
   * auto-manage. `undefined` disables the hint entirely (default).
   */
  cacheTarget?: CacheTarget;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  compressionProfileId: 'standard',
  semanticBudget: DEFAULT_SEMANTIC_BUDGET,
  autoCompress: false,
  autoCompressOnPaste: false,
  siteWhitelist: [],
  piiMode: 'off',
  theme: 'dark',
  fontPreset: 'modern',
  targetModel: 'gpt-4o',
};

function isProfileId(value: unknown): value is PaktLayerProfileId {
  return typeof value === 'string' && PROFILE_IDS.includes(value as PaktLayerProfileId);
}

function isPIIMode(value: unknown): value is PIIMode {
  return typeof value === 'string' && PII_MODES.includes(value as PIIMode);
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
    autoCompressOnPaste:
      typeof raw.autoCompressOnPaste === 'boolean'
        ? raw.autoCompressOnPaste
        : DEFAULT_SETTINGS.autoCompressOnPaste,
    siteWhitelist: Array.isArray(raw.siteWhitelist)
      ? raw.siteWhitelist.filter((entry): entry is string => typeof entry === 'string')
      : DEFAULT_SETTINGS.siteWhitelist,
    piiMode: isPIIMode(raw.piiMode) ? raw.piiMode : DEFAULT_SETTINGS.piiMode,
    theme: isTheme(raw.theme) ? raw.theme : DEFAULT_SETTINGS.theme,
    fontPreset: isFontPreset(raw.fontPreset) ? raw.fontPreset : DEFAULT_SETTINGS.fontPreset,
    targetModel:
      typeof raw.targetModel === 'string' && raw.targetModel.length > 0
        ? raw.targetModel
        : DEFAULT_SETTINGS.targetModel,
    ...(isCacheTarget(raw.cacheTarget) ? { cacheTarget: raw.cacheTarget } : {}),
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

  if (typeof raw.autoCompressOnPaste === 'boolean') {
    updated.autoCompressOnPaste = raw.autoCompressOnPaste;
  }

  if (Array.isArray(raw.siteWhitelist)) {
    updated.siteWhitelist = raw.siteWhitelist.filter(
      (entry): entry is string => typeof entry === 'string',
    );
  }

  if (isPIIMode(raw.piiMode)) {
    updated.piiMode = raw.piiMode;
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

  /* `cacheTarget` accepts undefined to mean "off" — both must round-trip. */
  if (raw.cacheTarget === undefined || raw.cacheTarget === null) {
    updated.cacheTarget = undefined;
  } else if (isCacheTarget(raw.cacheTarget)) {
    updated.cacheTarget = raw.cacheTarget;
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
