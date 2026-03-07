import type { PaktFormat } from '@sriinnu/pakt';
import {
  analyzePreview,
  compressSource,
  computeComparison,
  decompressSource,
  preloadPakt,
} from './pakt-service';

type WorkerRequest =
  | { id: number; type: 'preload' }
  | { id: number; type: 'analyzePreview'; input: string; liveCompress: boolean }
  | { id: number; type: 'compressSource'; input: string }
  | { id: number; type: 'decompressSource'; input: string; format: PaktFormat }
  | { id: number; type: 'computeComparison'; input: string };

type WorkerResponse =
  | { id: number; ok: true; payload: unknown }
  | { id: number; ok: false; error: string };

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Worker request failed';
}

function respond(message: WorkerResponse): void {
  self.postMessage(message);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  try {
    switch (message.type) {
      case 'preload':
        await preloadPakt();
        respond({ id: message.id, ok: true, payload: null });
        return;
      case 'analyzePreview':
        respond({
          id: message.id,
          ok: true,
          payload: await analyzePreview(message.input, message.liveCompress),
        });
        return;
      case 'compressSource':
        respond({
          id: message.id,
          ok: true,
          payload: await compressSource(message.input),
        });
        return;
      case 'decompressSource':
        respond({
          id: message.id,
          ok: true,
          payload: await decompressSource(message.input, message.format),
        });
        return;
      case 'computeComparison':
        respond({
          id: message.id,
          ok: true,
          payload: await computeComparison(message.input),
        });
        return;
      default: {
        const exhaustive: never = message;
        throw new Error(`Unknown worker message: ${JSON.stringify(exhaustive)}`);
      }
    }
  } catch (error) {
    respond({
      id: message.id,
      ok: false,
      error: getErrorMessage(error),
    });
  }
};
