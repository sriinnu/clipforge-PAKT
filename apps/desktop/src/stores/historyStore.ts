import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const MAX_ENTRIES = 100;

export interface HistoryEntry {
  id: string;
  timestamp: number;
  input: string;
  output: string;
  format: string;
  savedTokens: number;
}

interface HistoryState {
  entries: HistoryEntry[];
  addEntry: (entry: Omit<HistoryEntry, 'id' | 'timestamp'>) => void;
  clearHistory: () => void;
  search: (query: string) => HistoryEntry[];
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      entries: [],
      addEntry: (entry) =>
        set((state) => {
          const latest = state.entries[0];
          if (
            latest &&
            latest.input === entry.input &&
            latest.output === entry.output &&
            latest.format === entry.format &&
            latest.savedTokens === entry.savedTokens
          ) {
            return state;
          }

          const newEntry: HistoryEntry = {
            ...entry,
            id: generateId(),
            timestamp: Date.now(),
          };
          const updated = [newEntry, ...state.entries].slice(0, MAX_ENTRIES);
          return { entries: updated };
        }),
      clearHistory: () => set({ entries: [] }),
      search: (query) => {
        const lower = query.toLowerCase();
        return get().entries.filter(
          (e) =>
            e.input.toLowerCase().includes(lower) ||
            e.output.toLowerCase().includes(lower) ||
            e.format.toLowerCase().includes(lower),
        );
      },
    }),
    { name: 'clipforge-history' },
  ),
);
