/**
 * Model providers for the PAKT comprehension eval.
 *
 * All providers expose the same shape:
 *   { name, model, ask(prompt, ctx) -> Promise<{text, usage: {input, output}}> }
 *
 * Anthropic and OpenAI-compatible endpoints are called via raw fetch (no SDK
 * dependency in this monorepo). The mock provider never touches the network.
 */

const MAX_TOKENS = 1024;
const RETRIES = 3;

/** Sleeps for ms milliseconds. @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch with retry on 429/5xx/overload, exponential backoff.
 * @param {string} url
 * @param {RequestInit} init
 * @returns {Promise<any>} Parsed JSON body.
 */
async function fetchJson(url, init) {
  let lastErr;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res.json();
    const body = await res.text();
    lastErr = new Error(`HTTP ${res.status} from ${url}: ${body.slice(0, 300)}`);
    if (![429, 500, 529, 502, 503].includes(res.status)) throw lastErr;
    await sleep(1000 * 2 ** attempt);
  }
  throw lastErr;
}

/**
 * Creates an Anthropic Messages API provider (raw fetch, anthropic-version
 * 2023-06-01). Fable 5 family: no sampling params, no thinking param.
 * @param {{model: string, apiKey: string}} opts
 * @returns {{name: string, model: string, ask: (prompt: string) => Promise<{text: string, usage: {input: number, output: number}}>}}
 */
export function anthropicProvider({ model, apiKey }) {
  return {
    name: 'anthropic',
    model,
    async ask(prompt) {
      const data = await fetchJson('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const text = (data.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return {
        text,
        usage: { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 },
      };
    },
  };
}

/**
 * Creates an OpenAI-compatible chat-completions provider (raw fetch). Works
 * with api.openai.com or any compatible endpoint via OPENAI_BASE_URL.
 * @param {{model: string, apiKey: string, baseUrl?: string}} opts
 * @returns {{name: string, model: string, ask: (prompt: string) => Promise<{text: string, usage: {input: number, output: number}}>}}
 */
export function openAiProvider({ model, apiKey, baseUrl = 'https://api.openai.com/v1' }) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  return {
    name: 'openai',
    model,
    async ask(prompt) {
      const data = await fetchJson(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      return {
        text: data.choices?.[0]?.message?.content ?? '',
        usage: {
          input: data.usage?.prompt_tokens ?? 0,
          output: data.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}

/**
 * Task ids the mock provider answers WRONG on purpose, proving the scorer can
 * fail a mismatch (mock runs should report exactly these as incorrect).
 */
export const MOCK_WRONG_IDS = new Set(['users-03']);

/**
 * Mock echo provider: returns the ground-truth answer with cosmetic noise
 * (casing, trailing period, quoting) to exercise normalization — except for
 * MOCK_WRONG_IDS, where it returns a deliberately wrong answer. Network-free;
 * proves pipeline mechanics and scoring without spending tokens.
 * @returns {{name: string, model: string, ask: (prompt: string, ctx: {task: import('./tasks.mjs').EvalTask, index: number}) => Promise<{text: string, usage: {input: number, output: number}}>}}
 */
export function mockProvider() {
  return {
    name: 'mock',
    model: 'mock-echo',
    async ask(_prompt, ctx) {
      const { task, index } = ctx;
      let text;
      if (MOCK_WRONG_IDS.has(task.id)) {
        text = 'deliberately-wrong-answer';
      } else {
        const base = String(task.expected);
        const variant = index % 3;
        text = variant === 0 ? `${base.toUpperCase()}.` : variant === 1 ? `"${base}"` : `  ${base}  `;
      }
      return { text, usage: { input: 0, output: 0 } };
    },
  };
}
