import { DEFAULT_SEMANTIC_BUDGET, type PaktFormat, type PaktLayers } from '@sriinnu/pakt';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  outputFormat: PaktFormat;
  model: string;
  autoCompress: boolean;
  historyEnabled: boolean;
  theme: 'system' | 'light' | 'dark';
  semanticBudget: number;
  layers: PaktLayers;
  setOutputFormat: (f: PaktFormat) => void;
  setModel: (m: string) => void;
  setAutoCompress: (v: boolean) => void;
  setHistoryEnabled: (v: boolean) => void;
  setTheme: (t: 'system' | 'light' | 'dark') => void;
  setSemanticBudget: (v: number) => void;
  toggleLayer: (key: keyof PaktLayers) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      outputFormat: 'json',
      model: 'gpt-4o',
      autoCompress: false,
      historyEnabled: false,
      theme: 'system',
      semanticBudget: DEFAULT_SEMANTIC_BUDGET,
      layers: {
        structural: true,
        dictionary: true,
        tokenizerAware: false,
        semantic: false,
      },
      setOutputFormat: (f) => set({ outputFormat: f }),
      setModel: (m) => set({ model: m }),
      setAutoCompress: (v) => set({ autoCompress: v }),
      setHistoryEnabled: (v) => set({ historyEnabled: v }),
      setTheme: (t) => set({ theme: t }),
      setSemanticBudget: (v) =>
        set({ semanticBudget: Number.isInteger(v) && v > 0 ? v : DEFAULT_SEMANTIC_BUDGET }),
      toggleLayer: (key) =>
        set((state) => ({
          layers: {
            ...state.layers,
            [key]: !state.layers[key],
          },
        })),
    }),
    { name: 'clipforge-settings' },
  ),
);
