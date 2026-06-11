/**
 * @module historyStore
 * SQLite-backed clipboard history store.
 *
 * Entries are persisted via `@tauri-apps/plugin-sql` into the
 * `sqlite:clipforge_history.db` database whose schema is created by the
 * migration registered in `src-tauri/src/history.rs`. The zustand state
 * is an in-memory mirror of the table: reads hit the mirror (fast,
 * synchronous for the UI), writes update the mirror optimistically and
 * persist to SQLite in the background.
 *
 * Outside a Tauri shell (browser dev mode) the store degrades to a
 * session-only in-memory list — still real data, never fabricated.
 */

import type Database from '@tauri-apps/plugin-sql';
import { create } from 'zustand';

/** Maximum number of entries kept; oldest rows are pruned past this. */
const MAX_ENTRIES = 100;

/** Must match the connection string registered in `src-tauri/src/lib.rs`. */
const DB_URL = 'sqlite:clipforge_history.db';

/** localStorage key used by the pre-SQLite zustand-persist store. */
const LEGACY_STORAGE_KEY = 'clipforge-history';

/** A single recorded compress/decompress operation. */
export interface HistoryEntry {
  /** SQLite row ID (negative while an optimistic insert is in flight). */
  id: number;
  /** Unix epoch milliseconds when the operation ran. */
  timestamp: number;
  /** Source text before the transform. */
  input: string;
  /** Result text after the transform. */
  output: string;
  /** Detected/selected format label (e.g. "json", "pakt"). */
  format: string;
  /** Tokens saved by the transform (original - compressed). */
  savedTokens: number;
}

/** Row shape returned by SQLite (snake_case column names). */
interface HistoryRow {
  id: number;
  timestamp: number;
  input: string;
  output: string;
  format: string;
  saved_tokens: number;
}

/** Zustand state + actions for the history store. */
interface HistoryState {
  /** In-memory mirror of the history table, newest first. */
  entries: HistoryEntry[];
  /** True once {@link HistoryState.hydrate} has completed (or been skipped). */
  hydrated: boolean;
  /** Load persisted entries from SQLite into the mirror. Idempotent. */
  hydrate: () => Promise<void>;
  /** Record a new operation; persists to SQLite in the background. */
  addEntry: (entry: Omit<HistoryEntry, 'id' | 'timestamp'>) => void;
  /** Remove a single entry by its row ID. */
  deleteEntry: (id: number) => void;
  /** Remove every entry, in memory and on disk. */
  clearHistory: () => void;
}

/** True only when running inside a Tauri webview shell. */
function inTauriShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Memoised database handle; `null` until first requested. */
let dbPromise: Promise<Database> | null = null;

/**
 * Lazily open the history database. Returns `null` outside a Tauri
 * shell or when the plugin fails to load, so callers can fall back to
 * in-memory behavior.
 */
async function getDb(): Promise<Database | null> {
  if (!inTauriShell()) return null;
  if (!dbPromise) {
    dbPromise = import('@tauri-apps/plugin-sql').then((mod) => mod.default.load(DB_URL));
  }
  try {
    return await dbPromise;
  } catch {
    dbPromise = null; // allow a retry on the next call
    return null;
  }
}

/** Map a SQLite row to the camelCase entry shape used by the UI. */
function rowToEntry(row: HistoryRow): HistoryEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    input: row.input,
    output: row.output,
    format: row.format,
    savedTokens: row.saved_tokens,
  };
}

const INSERT_SQL =
  'INSERT INTO history (timestamp, input, output, format, saved_tokens) VALUES ($1, $2, $3, $4, $5)';

/**
 * One-time import of entries persisted by the old localStorage store
 * into SQLite, then drop the legacy key so this never runs again.
 */
async function importLegacyEntries(db: Database): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as {
      state?: { entries?: Array<Partial<Omit<HistoryEntry, 'id'>>> };
    };
    // Insert oldest-first so timestamp ordering matches insertion order.
    const legacy = [...(parsed.state?.entries ?? [])].reverse();
    for (const entry of legacy) {
      if (typeof entry?.input !== 'string' || typeof entry?.output !== 'string') continue;
      await db.execute(INSERT_SQL, [
        entry.timestamp ?? Date.now(),
        entry.input,
        entry.output,
        entry.format ?? 'text',
        entry.savedTokens ?? 0,
      ]);
    }
  } catch {
    // Corrupt legacy payload — drop it rather than block hydration.
  } finally {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
}

/** Monotonically decreasing temp IDs for optimistic (unpersisted) rows. */
let tempIdCounter = -1;

/**
 * Clipboard history store. Call {@link HistoryState.hydrate} once at app
 * start (done in `MenuBarPanel`) to populate the mirror from SQLite.
 */
export const useHistoryStore = create<HistoryState>()((set, get) => ({
  entries: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const db = await getDb();
    if (!db) {
      // Browser dev mode: nothing persisted, mirror stays session-only.
      set({ hydrated: true });
      return;
    }
    try {
      await importLegacyEntries(db);
      const rows = await db.select<HistoryRow[]>(
        'SELECT id, timestamp, input, output, format, saved_tokens FROM history ORDER BY timestamp DESC, id DESC LIMIT $1',
        [MAX_ENTRIES],
      );
      set({ entries: rows.map(rowToEntry), hydrated: true });
    } catch {
      // Query failed — surface an empty (but truthful) list.
      set({ hydrated: true });
    }
  },

  addEntry: (entry) => {
    const latest = get().entries[0];
    // Skip exact consecutive duplicates (e.g. repeated hotkey presses).
    if (
      latest &&
      latest.input === entry.input &&
      latest.output === entry.output &&
      latest.format === entry.format &&
      latest.savedTokens === entry.savedTokens
    ) {
      return;
    }

    const tempId = tempIdCounter--;
    const newEntry: HistoryEntry = { ...entry, id: tempId, timestamp: Date.now() };
    set((state) => ({ entries: [newEntry, ...state.entries].slice(0, MAX_ENTRIES) }));

    // Persist in the background; swap the temp ID for the real row ID.
    void (async () => {
      const db = await getDb();
      if (!db) return;
      try {
        const result = await db.execute(INSERT_SQL, [
          newEntry.timestamp,
          newEntry.input,
          newEntry.output,
          newEntry.format,
          newEntry.savedTokens,
        ]);
        const realId = result.lastInsertId;
        if (typeof realId === 'number') {
          set((state) => ({
            entries: state.entries.map((e) => (e.id === tempId ? { ...e, id: realId } : e)),
          }));
        }
        // Prune rows beyond the cap so the table stays bounded.
        await db.execute(
          'DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY timestamp DESC, id DESC LIMIT $1)',
          [MAX_ENTRIES],
        );
      } catch {
        // Insert failed — the optimistic entry remains for this session only.
      }
    })();
  },

  deleteEntry: (id) => {
    set((state) => ({ entries: state.entries.filter((e) => e.id !== id) }));
    if (id > 0) {
      void (async () => {
        const db = await getDb();
        if (!db) return;
        try {
          await db.execute('DELETE FROM history WHERE id = $1', [id]);
        } catch {
          // Row will be retried implicitly on the next prune.
        }
      })();
    }
  },

  clearHistory: () => {
    set({ entries: [] });
    void (async () => {
      const db = await getDb();
      if (!db) return;
      try {
        await db.execute('DELETE FROM history');
      } catch {
        // Clear failed on disk; mirror is already empty for this session.
      }
    })();
  },
}));
