import {
  type CacheTarget,
  DEFAULT_SEMANTIC_BUDGET,
  type PaktFormat,
  type PaktLayers,
} from '@sriinnu/pakt';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Font preset identifier — matches the extension's FontPreset type. */
export type FontPreset = 'modern' | 'classic' | 'rounded' | 'system';

interface SettingsState {
  outputFormat: PaktFormat;
  model: string;
  autoCompress: boolean;
  historyEnabled: boolean;
  theme: 'system' | 'light' | 'dark' | 'oled';
  /** Active font preset — 'modern' is the default. */
  fontPreset: FontPreset;
  semanticBudget: number;
  layers: PaktLayers;
  /**
   * Provider cache target. When set, `compress()` returns a
   * `cacheBreakpoint` hint with byte offset + recommended TTL.
   * `undefined` disables the hint entirely (default).
   */
  cacheTarget: CacheTarget | undefined;
  setOutputFormat: (f: PaktFormat) => void;
  setModel: (m: string) => void;
  setAutoCompress: (v: boolean) => void;
  setHistoryEnabled: (v: boolean) => void;
  setTheme: (t: 'system' | 'light' | 'dark' | 'oled') => void;
  setFontPreset: (p: FontPreset) => void;
  setSemanticBudget: (v: number) => void;
  toggleLayer: (key: keyof PaktLayers) => void;
  setCacheTarget: (target: CacheTarget | undefined) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      outputFormat: 'json',
      model: 'gpt-4o',
      autoCompress: false,
      historyEnabled: false,
      theme: 'system',
      fontPreset: 'modern',
      semanticBudget: DEFAULT_SEMANTIC_BUDGET,
      layers: {
        structural: true,
        dictionary: true,
        tokenizerAware: false,
        semantic: false,
        contentAware: false,
      },
      cacheTarget: undefined,
      setOutputFormat: (f) => set({ outputFormat: f }),
      setModel: (m) => set({ model: m }),
      setAutoCompress: (v) => set({ autoCompress: v }),
      setHistoryEnabled: (v) => set({ historyEnabled: v }),
      setTheme: (t) => set({ theme: t }),
      setFontPreset: (p) => set({ fontPreset: p }),
      setSemanticBudget: (v) =>
        set({ semanticBudget: Number.isInteger(v) && v > 0 ? v : DEFAULT_SEMANTIC_BUDGET }),
      toggleLayer: (key) =>
        set((state) => ({
          layers: {
            ...state.layers,
            [key]: !state.layers[key],
          },
        })),
      setCacheTarget: (target) => set({ cacheTarget: target }),
    }),
    { name: 'clipforge-settings' },
  ),
);
