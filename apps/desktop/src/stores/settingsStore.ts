import type { PaktFormat, PaktLayers } from '@sriinnu/pakt';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  outputFormat: PaktFormat;
  model: string;
  autoCompress: boolean;
  theme: 'system' | 'light' | 'dark';
  layers: PaktLayers;
  setOutputFormat: (f: PaktFormat) => void;
  setModel: (m: string) => void;
  setAutoCompress: (v: boolean) => void;
  setTheme: (t: 'system' | 'light' | 'dark') => void;
  toggleLayer: (key: keyof PaktLayers) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      outputFormat: 'json',
      model: 'gpt-4o',
      autoCompress: false,
      theme: 'system',
      layers: {
        structural: true,
        dictionary: true,
        tokenizerAware: false,
        semantic: false,
      },
      setOutputFormat: (f) => set({ outputFormat: f }),
      setModel: (m) => set({ model: m }),
      setAutoCompress: (v) => set({ autoCompress: v }),
      setTheme: (t) => set({ theme: t }),
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
