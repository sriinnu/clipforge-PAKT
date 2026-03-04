import { afterEach, describe, expect, it } from 'vitest';

import { countTokens } from '../src/tokens/counter.js';
import { GptTokenCounter } from '../src/tokens/gpt-counter.js';
import {
  getTokenCounter,
  registerTokenCounter,
  resetTokenCounterRegistry,
} from '../src/tokens/registry.js';
import type { TokenCounter, TokenCounterFactory } from '../src/tokens/types.js';

// ---------------------------------------------------------------------------
// Reset registry between tests to avoid side-effects
// ---------------------------------------------------------------------------

afterEach(() => {
  resetTokenCounterRegistry();
});

// ===========================================================================
// 1. Default counter (GPT BPE fallback)
// ===========================================================================

describe('default counter (GPT BPE fallback)', () => {
  it('returns a GptTokenCounter when no custom factory is registered', () => {
    const counter = getTokenCounter('gpt-4o');
    expect(counter).toBeInstanceOf(GptTokenCounter);
    expect(counter.model).toBe('gpt-4o');
  });

  it('counts tokens correctly with the default counter', () => {
    const counter = getTokenCounter('gpt-4o');
    const count = counter.count('Hello, world!');
    expect(count).toBeGreaterThan(0);
    expect(Number.isInteger(count)).toBe(true);
  });

  it('returns 0 for an empty string', () => {
    const counter = getTokenCounter('gpt-4o');
    expect(counter.count('')).toBe(0);
  });

  it('falls back to GPT BPE for unknown model names', () => {
    const counter = getTokenCounter('some-unknown-model');
    expect(counter).toBeInstanceOf(GptTokenCounter);
    expect(counter.model).toBe('some-unknown-model');
    expect(counter.count('test')).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 2. Registering a custom counter
// ===========================================================================

describe('registerTokenCounter', () => {
  it('allows registering a custom factory', () => {
    const customFactory: TokenCounterFactory = (model) => {
      if (model === 'custom-model') {
        return { model, count: () => 42 };
      }
      return null;
    };

    registerTokenCounter(customFactory);
    const counter = getTokenCounter('custom-model');
    expect(counter.model).toBe('custom-model');
    expect(counter.count('anything')).toBe(42);
  });

  it('falls back to GPT BPE when custom factory returns null', () => {
    const selectiveFactory: TokenCounterFactory = (model) => {
      if (model === 'only-this-one') {
        return { model, count: () => 99 };
      }
      return null;
    };

    registerTokenCounter(selectiveFactory);

    // Factory handles this model
    expect(getTokenCounter('only-this-one').count('x')).toBe(99);

    // Factory returns null for other models -> GPT fallback
    const fallback = getTokenCounter('gpt-4o');
    expect(fallback).toBeInstanceOf(GptTokenCounter);
  });
});

// ===========================================================================
// 3. Custom counter takes priority over default
// ===========================================================================

describe('custom counter priority', () => {
  it('most recently registered factory is checked first', () => {
    const firstFactory: TokenCounterFactory = (model) => {
      if (model.startsWith('claude-')) {
        return { model, count: () => 100 };
      }
      return null;
    };

    const secondFactory: TokenCounterFactory = (model) => {
      if (model.startsWith('claude-')) {
        return { model, count: () => 200 };
      }
      return null;
    };

    registerTokenCounter(firstFactory);
    registerTokenCounter(secondFactory);

    // Second (most recent) factory wins
    const counter = getTokenCounter('claude-sonnet');
    expect(counter.count('test')).toBe(200);
  });

  it('skips factories that return null and uses the next match', () => {
    const narrowFactory: TokenCounterFactory = (model) => {
      if (model === 'claude-opus') {
        return { model, count: () => 500 };
      }
      return null;
    };

    const broadFactory: TokenCounterFactory = (model) => {
      if (model.startsWith('claude-')) {
        return { model, count: () => 300 };
      }
      return null;
    };

    // Register broad first, narrow second (narrow checked first)
    registerTokenCounter(broadFactory);
    registerTokenCounter(narrowFactory);

    // Narrow factory matches 'claude-opus'
    expect(getTokenCounter('claude-opus').count('x')).toBe(500);

    // Narrow factory returns null for 'claude-sonnet', broad factory matches
    expect(getTokenCounter('claude-sonnet').count('x')).toBe(300);

    // Neither factory matches, falls back to GPT
    const fallback = getTokenCounter('gpt-4o');
    expect(fallback).toBeInstanceOf(GptTokenCounter);
  });
});

// ===========================================================================
// 4. resetTokenCounterRegistry
// ===========================================================================

describe('resetTokenCounterRegistry', () => {
  it('restores defaults by clearing all registered factories', () => {
    const customFactory: TokenCounterFactory = (model) => {
      if (model === 'test-model') {
        return { model, count: () => 77 };
      }
      return null;
    };

    registerTokenCounter(customFactory);
    expect(getTokenCounter('test-model').count('x')).toBe(77);

    resetTokenCounterRegistry();

    // After reset, custom factory is gone -> GPT fallback
    const counter = getTokenCounter('test-model');
    expect(counter).toBeInstanceOf(GptTokenCounter);
    expect(counter.count('Hello')).toBeGreaterThan(0);
  });

  it('can register new factories after reset', () => {
    registerTokenCounter(() => ({ model: 'a', count: () => 1 }));
    resetTokenCounterRegistry();
    registerTokenCounter(() => ({ model: 'b', count: () => 2 }));

    const counter = getTokenCounter('anything');
    expect(counter.model).toBe('b');
    expect(counter.count('x')).toBe(2);
  });
});

// ===========================================================================
// 5. countTokens uses registry
// ===========================================================================

describe('countTokens uses registry', () => {
  it('uses the default GPT counter when no custom factory is registered', () => {
    const tokens = countTokens('Hello, world!');
    expect(tokens).toBeGreaterThan(0);
    expect(Number.isInteger(tokens)).toBe(true);
  });

  it('uses a custom counter when one is registered for the model', () => {
    const fixedCounter: TokenCounter = { model: 'my-model', count: () => 123 };
    registerTokenCounter((model) => (model === 'my-model' ? fixedCounter : null));

    const tokens = countTokens('any text here', 'my-model');
    expect(tokens).toBe(123);
  });

  it('falls back to GPT when custom factory does not match', () => {
    registerTokenCounter((model) =>
      model === 'special' ? { model, count: () => 999 } : null,
    );

    // 'gpt-4o' is not handled by our factory
    const tokens = countTokens('Hello, world!', 'gpt-4o');
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).not.toBe(999);
  });

  it('defaults to gpt-4o when no model is specified', () => {
    // Register a factory that only handles 'gpt-4o'
    registerTokenCounter((model) =>
      model === 'gpt-4o' ? { model, count: () => 7 } : null,
    );

    // countTokens with no model should default to 'gpt-4o'
    const tokens = countTokens('test');
    expect(tokens).toBe(7);
  });
});

// ===========================================================================
// 6. GptTokenCounter class
// ===========================================================================

describe('GptTokenCounter', () => {
  it('implements the TokenCounter interface', () => {
    const counter: TokenCounter = new GptTokenCounter('gpt-4o');
    expect(counter.model).toBe('gpt-4o');
    expect(typeof counter.count).toBe('function');
  });

  it('produces consistent results for the same input', () => {
    const counter = new GptTokenCounter('gpt-4o');
    const text = 'The quick brown fox jumps over the lazy dog.';
    const first = counter.count(text);
    const second = counter.count(text);
    expect(first).toBe(second);
  });
});
