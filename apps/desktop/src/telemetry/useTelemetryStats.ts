/**
 * @module telemetry/useTelemetryStats
 * React hook that polls the Rust `read_pakt_stats` command and exposes
 * an aggregated {@link TelemetrySnapshot} for the dashboard.
 *
 * Live updates use a 5-second poll instead of a file watcher because
 * neither `@tauri-apps/plugin-fs` (watch API) nor the Rust `notify`
 * crate is currently a dependency — adding either would grow the native
 * surface for marginal gain. The hook only runs while TelemetryPanel is
 * mounted, and the panel is only mounted while the tray window is
 * visible, so the poll costs nothing when the app is in the background.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { aggregateTelemetry, type TelemetrySnapshot } from './stats-aggregate';
import { parseStatsSnapshot, type RawStatsSnapshot } from './stats-schema';

/** Poll interval while the telemetry panel is visible. */
const POLL_INTERVAL_MS = 5000;

/** Loading lifecycle of the telemetry feed. */
export type TelemetryStatus = 'loading' | 'ready' | 'unavailable';

/** State returned by {@link useTelemetryStats}. */
export interface TelemetryState {
  /** `unavailable` means no Tauri shell (browser dev) or IPC failure. */
  status: TelemetryStatus;
  /** Aggregated dashboard model; null until the first read completes. */
  snapshot: TelemetrySnapshot | null;
  /** Whether `~/.pakt/stats` exists on disk (drives onboarding copy). */
  dirExists: boolean;
  /** Force an immediate re-read outside the poll cadence. */
  refresh: () => void;
}

/* True only when running inside a Tauri webview shell. */
function inTauriShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Poll PAKT's stats directory and aggregate it into dashboard data.
 * Mount-scoped: polling starts on mount and stops on unmount.
 */
export function useTelemetryStats(): TelemetryState {
  const [status, setStatus] = useState<TelemetryStatus>('loading');
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null);
  const [dirExists, setDirExists] = useState(false);
  // Guards against state updates after unmount (poll resolves late).
  const activeRef = useRef(true);

  const load = useCallback(async () => {
    if (!inTauriShell()) {
      if (activeRef.current) setStatus('unavailable');
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const raw = await invoke<RawStatsSnapshot>('read_pakt_stats');
      if (!activeRef.current) return;
      setDirExists(raw.dirExists);
      setSnapshot(aggregateTelemetry(parseStatsSnapshot(raw)));
      setStatus('ready');
    } catch {
      // IPC failure — surface the onboarding/empty state, never crash.
      if (activeRef.current) setStatus('unavailable');
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    void load();
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      activeRef.current = false;
      window.clearInterval(timer);
    };
  }, [load]);

  const refresh = useCallback(() => void load(), [load]);

  return { status, snapshot, dirExists, refresh };
}
