import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import * as runtime from './pakt-runtime';

vi.mock('./pakt-runtime', () => ({
  preloadPaktRuntime: vi.fn(),
  analyzePreview: vi.fn(),
  compressSource: vi.fn(),
  computeComparison: vi.fn(),
  decompressSource: vi.fn(),
}));

const mockedRuntime = vi.mocked(runtime);

function createPreviewResult(
  overrides: Partial<Awaited<ReturnType<typeof runtime.analyzePreview>>> = {},
) {
  return {
    detectedFormat: 'json' as const,
    inputTokens: 42,
    packedInputDetected: false,
    output: 'pakt-output',
    outputTokens: 21,
    error: null,
    lastAction: 'compress' as const,
    ...overrides,
  };
}

function createComparisonState(
  overrides: Partial<Awaited<ReturnType<typeof runtime.computeComparison>>> = {},
) {
  return {
    status: 'ready' as const,
    items: [
      {
        id: 'original' as const,
        label: 'Original',
        tokens: 42,
        percent: 'Baseline',
        delta: '0 tokens saved',
        note: 'Raw source payload before any structural rewrite.',
        text: '{"demo":true}',
      },
    ],
    error: null,
    ...overrides,
  };
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('App', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    mockedRuntime.preloadPaktRuntime.mockResolvedValue(undefined);
    mockedRuntime.analyzePreview.mockResolvedValue(createPreviewResult());
    mockedRuntime.compressSource.mockResolvedValue({
      detectedFormat: 'json',
      inputTokens: 42,
      packedInputDetected: false,
      output: 'pakt-output',
      outputTokens: 21,
    });
    mockedRuntime.computeComparison.mockResolvedValue(createComparisonState());
    mockedRuntime.decompressSource.mockResolvedValue({
      detectedFormat: 'pakt',
      inputTokens: 21,
      packedInputDetected: true,
      output: '{"demo":true}',
      outputTokens: 42,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('surfaces preview worker failures in the error banner', async () => {
    mockedRuntime.analyzePreview.mockRejectedValueOnce(new Error('worker exploded'));

    render(<App />);
    await advance(200);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('worker exploded');
  });

  it('surfaces comparison worker failures inside compare mode', async () => {
    mockedRuntime.computeComparison.mockRejectedValueOnce(new Error('compare exploded'));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Compare Layers' }));
    await advance(220);

    expect(screen.getByText('Comparison unavailable')).toBeTruthy();
    expect(screen.getByText('compare exploded')).toBeTruthy();
  });

  it('lets the sample selector stay in custom mode', () => {
    render(<App />);

    const sampleSelect = screen.getByLabelText('Sample payload') as HTMLSelectElement;
    fireEvent.change(sampleSelect, { target: { value: '' } });

    expect(sampleSelect.value).toBe('');
    expect(screen.getByText('Editing a custom payload.')).toBeTruthy();
  });
});
