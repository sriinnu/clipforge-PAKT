import type { PaktFormat, PaktLayerProfileId } from '@sriinnu/pakt';
import type {
  ComparisonState,
  CompressionConfig,
  CompressionResult,
  DecompressionResult,
  PreviewResult,
} from './pakt-service';

type WorkerMessage =
  | { type: 'preload' }
  | { type: 'analyzePreview'; input: string; liveCompress: boolean; config: CompressionConfig }
  | { type: 'compressSource'; input: string; config: CompressionConfig }
  | { type: 'decompressSource'; input: string; format: PaktFormat }
  | { type: 'computeComparison'; input: string; semanticBudget?: number };

type WorkerResponse =
  | { id: number; ok: true; payload: unknown }
  | { id: number; ok: false; error: string };

let requestId = 0;
let paktWorker: Worker | null = null;
const pending = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }
>();

function rejectPending(reason: string): void {
  for (const request of pending.values()) {
    request.reject(new Error(reason));
  }
  pending.clear();
}

function resetWorker(reason: string): void {
  rejectPending(reason);
  if (paktWorker) {
    paktWorker.terminate();
    paktWorker = null;
  }
}

function getWorker(): Worker {
  if (paktWorker) {
    return paktWorker;
  }

  paktWorker = new Worker(new URL('./pakt-worker.ts', import.meta.url), {
    type: 'module',
  });

  paktWorker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const request = pending.get(message.id);

    if (!request) {
      return;
    }

    pending.delete(message.id);

    if (message.ok) {
      request.resolve(message.payload);
      return;
    }

    request.reject(new Error(message.error));
  });

  paktWorker.addEventListener('error', () => {
    resetWorker('The playground worker crashed. Retry the action.');
  });

  paktWorker.addEventListener('messageerror', () => {
    resetWorker('The playground worker returned an unreadable response.');
  });

  return paktWorker;
}

async function callWorker<T>(message: WorkerMessage): Promise<T> {
  const worker = getWorker();
  const id = ++requestId;

  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    try {
      worker.postMessage({ ...message, id });
    } catch (error) {
      pending.delete(id);
      reject(
        new Error(
          error instanceof Error
            ? error.message
            : 'The playground worker request could not be sent.',
        ),
      );
    }
  });
}

export async function preloadPaktRuntime(): Promise<void> {
  await callWorker<void>({ type: 'preload' });
}

export async function analyzePreview(
  input: string,
  liveCompress: boolean,
  config: CompressionConfig,
): Promise<PreviewResult> {
  return callWorker<PreviewResult>({ type: 'analyzePreview', input, liveCompress, config });
}

export async function compressSource(
  input: string,
  config: CompressionConfig,
): Promise<CompressionResult> {
  return callWorker<CompressionResult>({ type: 'compressSource', input, config });
}

export async function decompressSource(
  input: string,
  format: PaktFormat,
): Promise<DecompressionResult> {
  return callWorker<DecompressionResult>({ type: 'decompressSource', input, format });
}

export async function computeComparison(
  input: string,
  semanticBudget?: number,
): Promise<ComparisonState> {
  return callWorker<ComparisonState>({ type: 'computeComparison', input, semanticBudget });
}

export type {
  ComparisonItem,
  ComparisonState,
  CompressionConfig,
  CompressionResult,
  DecompressionResult,
  PreviewResult,
} from './pakt-service';
export type { PaktLayerProfileId };
