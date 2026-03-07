import type { PaktFormat } from '@sriinnu/pakt';
import type {
  ComparisonState,
  CompressionResult,
  DecompressionResult,
  PreviewResult,
} from './pakt-service';

type WorkerMessage =
  | { type: 'preload' }
  | { type: 'analyzePreview'; input: string; liveCompress: boolean }
  | { type: 'compressSource'; input: string }
  | { type: 'decompressSource'; input: string; format: PaktFormat }
  | { type: 'computeComparison'; input: string };

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
    worker.postMessage({ ...message, id });
  });
}

export async function preloadPaktRuntime(): Promise<void> {
  await callWorker<void>({ type: 'preload' });
}

export async function analyzePreview(input: string, liveCompress: boolean): Promise<PreviewResult> {
  return callWorker<PreviewResult>({ type: 'analyzePreview', input, liveCompress });
}

export async function compressSource(input: string): Promise<CompressionResult> {
  return callWorker<CompressionResult>({ type: 'compressSource', input });
}

export async function decompressSource(
  input: string,
  format: PaktFormat,
): Promise<DecompressionResult> {
  return callWorker<DecompressionResult>({ type: 'decompressSource', input, format });
}

export async function computeComparison(input: string): Promise<ComparisonState> {
  return callWorker<ComparisonState>({ type: 'computeComparison', input });
}

export type {
  ComparisonItem,
  ComparisonState,
  CompressionResult,
  DecompressionResult,
  PreviewResult,
} from './pakt-service';
