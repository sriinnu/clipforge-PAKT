/**
 * Chrome storage wrapper for extension settings.
 * Uses chrome.storage.sync so settings persist across devices.
 */

export interface ExtensionSettings {
  /** Enable L1 structural compression */
  layerStructural: boolean;
  /** Enable L2 dictionary compression */
  layerDictionary: boolean;
  /** Auto-compress pasted content */
  autoCompress: boolean;
  /** Theme: 'system' | 'dark' | 'light' */
  theme: 'system' | 'dark' | 'light';
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  layerStructural: true,
  layerDictionary: true,
  autoCompress: false,
  theme: 'dark',
};

/**
 * Get current extension settings from chrome.storage.sync.
 * Falls back to defaults for any missing keys.
 */
export async function getSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      resolve(items as ExtensionSettings);
    });
  });
}

/**
 * Save settings to chrome.storage.sync.
 * Merges partial updates with existing settings.
 */
export async function saveSettings(
  partial: Partial<ExtensionSettings>,
): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set(partial, () => {
      resolve();
    });
  });
}

/**
 * Listen for settings changes.
 * Calls the callback whenever any setting is updated.
 */
export function onSettingsChange(
  callback: (changes: Partial<ExtensionSettings>) => void,
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
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
