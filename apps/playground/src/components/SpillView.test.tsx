import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as runtime from '../pakt-runtime';
import { SpillView } from './SpillView';

vi.mock('../pakt-runtime', () => ({ spillPreview: vi.fn() }));
const mocked = vi.mocked(runtime);
afterEach(() => vi.clearAllMocks());

describe('SpillView', () => {
  it('sends the hook defaults and shows the gist the model would see', async () => {
    mocked.spillPreview.mockResolvedValue({
      spilled: true,
      id: 'sp_0123456789abcdef',
      originalTokens: 5200,
      tokens: 410,
      content: 'head\n[pakt spilled sp_0123456789abcdef]\ntail',
    });
    render(<SpillView />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview spill' }));
    await waitFor(() =>
      expect(screen.getByTestId('spill-summary').textContent).toContain('sp_0123456789abcdef'),
    );
    expect(mocked.spillPreview).toHaveBeenCalledWith(expect.stringContaining('error TS2322'), {
      thresholdTokens: 1000,
      headLines: 15,
      tailLines: 15,
    });
    expect(screen.getByTestId('spill-summary').textContent).toContain(
      '5200 → 410 tokens (4790 saved, 92%)',
    );
    expect(screen.getByLabelText('What the model sees').textContent).toContain('[pakt spilled');
  });

  it('says when output stays whole, and clamps the knobs', async () => {
    mocked.spillPreview.mockResolvedValue({
      spilled: false,
      originalTokens: 12,
      tokens: 12,
      content: 'ok',
    });
    render(<SpillView />);
    fireEvent.change(screen.getByLabelText('Command output'), { target: { value: 'ok' } });
    fireEvent.change(screen.getByLabelText('Tail lines'), { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview spill' }));
    await waitFor(() =>
      expect(screen.getByTestId('spill-summary').textContent).toContain('Not spilled'),
    );
    expect(mocked.spillPreview).toHaveBeenCalledWith('ok', {
      thresholdTokens: 1000,
      headLines: 15,
      tailLines: 200,
    });
  });
});
