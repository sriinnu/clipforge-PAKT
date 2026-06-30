import type { CacheTarget, PaktFormat } from '@sriinnu/pakt';
import type {
  CompressionConfig,
  ContextDemoMessage,
  ContextEngineDemoConfig,
  PackerRunItem,
} from './pakt-service';
import {
  analyzePreview,
  compressSource,
  computeComparison,
  decompressSource,
  getCompressibility,
  optimizeContext,
  preloadPakt,
  redactPiiText,
  runPacker,
  scanPii,
} from './pakt-service';

type WorkerRequest =
  | { id: number; type: 'preload' }
  | {
      id: number;
      type: 'analyzePreview';
      input: string;
      liveCompress: boolean;
      config: CompressionConfig;
    }
  | { id: number; type: 'compressSource'; input: string; config: CompressionConfig }
  | {
      id: number;
      type: 'decompressSource';
      input: string;
      format: PaktFormat;
      targetModel?: string;
    }
  | {
      id: number;
      type: 'computeComparison';
      input: string;
      semanticBudget?: number;
      targetModel?: string;
      cacheTarget?: CacheTarget;
    }
  | { id: number; type: 'compressibility'; text: string }
  | {
      id: number;
      type: 'optimizeContext';
      messages: ContextDemoMessage[];
      config: ContextEngineDemoConfig;
    }
  | { id: number; type: 'scanPii'; text: string }
  | { id: number; type: 'redactPii'; text: string }
  | { id: number; type: 'runPacker'; items: PackerRunItem[]; budget: number; model: string };

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
          payload: await analyzePreview(message.input, message.liveCompress, message.config),
        });
        return;
      case 'compressSource':
        respond({
          id: message.id,
          ok: true,
          payload: await compressSource(message.input, message.config),
        });
        return;
      case 'decompressSource':
        respond({
          id: message.id,
          ok: true,
          payload: await decompressSource(message.input, message.format, message.targetModel),
        });
        return;
      case 'computeComparison':
        respond({
          id: message.id,
          ok: true,
          payload: await computeComparison(
            message.input,
            message.semanticBudget,
            message.targetModel,
            message.cacheTarget,
          ),
        });
        return;
      case 'compressibility':
        /* Synchronous estimator — no await needed */
        respond({
          id: message.id,
          ok: true,
          payload: getCompressibility(message.text),
        });
        return;
      case 'optimizeContext':
        respond({
          id: message.id,
          ok: true,
          payload: await optimizeContext(message.messages, message.config),
        });
        return;
      case 'scanPii':
        respond({ id: message.id, ok: true, payload: await scanPii(message.text) });
        return;
      case 'redactPii':
        respond({ id: message.id, ok: true, payload: await redactPiiText(message.text) });
        return;
      case 'runPacker':
        respond({
          id: message.id,
          ok: true,
          payload: await runPacker(message.items, message.budget, message.model),
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
