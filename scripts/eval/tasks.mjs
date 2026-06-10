/**
 * Task definitions + answer scoring for the PAKT comprehension eval.
 *
 * Ground truths are COMPUTED from the committed datasets at load time (never
 * hardcoded), so they cannot drift from the data. Categories:
 *   - extraction:  point lookup of a single field
 *   - reasoning:   requires comparing / scanning entries (QA)
 *   - aggregation: counting / averaging across entries
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATASETS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'datasets');

/**
 * @typedef {Object} EvalTask
 * @property {string} id            Stable task id (e.g. "users-03").
 * @property {string} dataset       Dataset key: "users" | "config" | "logs".
 * @property {"extraction"|"reasoning"|"aggregation"} category
 * @property {string} question      Question shown to the model.
 * @property {string|number} expected  Ground-truth answer computed from data.
 * @property {"string"|"number"} match  Scoring mode.
 */

/**
 * Loads a committed dataset by key.
 * @param {"users"|"config"|"logs"} key
 * @returns {unknown} Parsed JSON data.
 */
export function loadDataset(key) {
  const file = { users: 'tabular-users.json', config: 'nested-config.json', logs: 'logs.json' }[key];
  if (!file) throw new Error(`Unknown dataset: ${key}`);
  return JSON.parse(readFileSync(join(DATASETS_DIR, file), 'utf8'));
}

/** @param {Array<Record<string, any>>} u Users dataset. @returns {EvalTask[]} */
function usersTasks(u) {
  const byId = (id) => u.find((x) => x.id === id);
  const oldest = u.reduce((a, b) => (b.age > a.age ? b : a));
  const cityCount = {};
  for (const x of u) cityCount[x.city] = (cityCount[x.city] || 0) + 1;
  const topCity = Object.entries(cityCount).sort((a, b) => b[1] - a[1])[0][0];
  const avgAge = Math.round((u.reduce((s, x) => s + x.age, 0) / u.length) * 10) / 10;
  const t = (id, category, question, expected, match = 'string') =>
    ({ id: `users-${id}`, dataset: 'users', category, question, expected, match });
  return [
    t('01', 'extraction', 'What is the email address of the user with id 23?', byId(23).email),
    t('02', 'extraction', 'What city does the user with id 41 live in?', byId(41).city),
    t('03', 'extraction', `What plan is ${byId(7).name} (id 7) on?`, byId(7).plan),
    t('04', 'extraction', 'What is the signup_date of the user with id 50?', byId(50).signup_date),
    t('05', 'reasoning', 'What is the name of the oldest user?', oldest.name),
    t('06', 'reasoning', 'Which city has the most users?', topCity),
    t('07', 'reasoning', `Is the user with id 12 active? Answer yes or no.`, byId(12).active ? 'yes' : 'no'),
    t('08', 'aggregation', 'How many users are on the enterprise plan?', u.filter((x) => x.plan === 'enterprise').length, 'number'),
    t('09', 'aggregation', 'How many users are active (active = true)?', u.filter((x) => x.active).length, 'number'),
    t('10', 'aggregation', 'How many users signed up in 2024 (signup_date starting with 2024)?', u.filter((x) => x.signup_date.startsWith('2024')).length, 'number'),
    t('11', 'aggregation', 'What is the average age of all users, rounded to 1 decimal place?', avgAge, 'number'),
  ];
}

/** @param {Record<string, any>} c Config dataset. @returns {EvalTask[]} */
function configTasks(c) {
  const svcs = c.services;
  const names = Object.keys(svcs);
  const retriesOff = names.filter((n) => svcs[n].retries?.enabled === false);
  const rateLimited = names.filter((n) => svcs[n].rate_limit?.enabled === true);
  const mostReplicas = names.reduce((a, b) => (svcs[b].replicas > svcs[a].replicas ? b : a));
  const totalReplicas = names.reduce((s, n) => s + svcs[n].replicas, 0);
  const t = (id, category, question, expected, match = 'string') =>
    ({ id: `config-${id}`, dataset: 'config', category, question, expected, match });
  return [
    t('01', 'extraction', 'What is the max_attempts value for the billing service retries?', svcs.billing.retries.max_attempts, 'number'),
    t('02', 'extraction', 'What is the timeout_ms of the search service?', svcs.search.timeout_ms, 'number'),
    t('03', 'extraction', 'What is the database pool max for the auth service?', svcs.auth.database.pool.max, 'number'),
    t('04', 'extraction', 'What is the log_level of the notifications service?', svcs.notifications.log_level),
    t('05', 'extraction', 'Which environment is this configuration for?', c.environment),
    t('06', 'reasoning', 'Which service has retries disabled?', retriesOff[0]),
    t('07', 'reasoning', 'Which service has the most replicas?', mostReplicas),
    t('08', 'reasoning', 'Is global tracing enabled? Answer yes or no.', c.global.tracing.enabled ? 'yes' : 'no'),
    t('09', 'reasoning', 'Which notification channel is disabled?', Object.keys(svcs.notifications.channels).find((k) => !svcs.notifications.channels[k].enabled)),
    t('10', 'aggregation', 'How many services have rate limiting enabled?', rateLimited.length, 'number'),
    t('11', 'aggregation', 'What is the total number of replicas across all services?', totalReplicas, 'number'),
  ];
}

/** @param {Array<Record<string, any>>} l Logs dataset. @returns {EvalTask[]} */
function logsTasks(l) {
  const errors = l.filter((x) => x.level === 'ERROR');
  const errAfterNoon = errors.filter((x) => x.ts.slice(11, 19) >= '12:00:00');
  const slowest = l.reduce((a, b) => (b.latency_ms > a.latency_ms ? b : a));
  const perSvc = {};
  for (const e of errors) perSvc[e.service] = (perSvc[e.service] || 0) + 1;
  const topErrSvc = Object.entries(perSvc).sort((a, b) => b[1] - a[1])[0][0];
  const t = (id, category, question, expected, match = 'string') =>
    ({ id: `logs-${id}`, dataset: 'logs', category, question, expected, match });
  return [
    t('01', 'extraction', 'What is the request_id of the log entry with the highest latency_ms?', slowest.request_id),
    t('02', 'extraction', `What is the message of the entry with request_id ${errors[0].request_id}?`, errors[0].message),
    t('03', 'extraction', 'What is the timestamp (ts) of the first ERROR entry?', errors[0].ts),
    t('04', 'extraction', `Which service produced the entry with request_id ${l[59].request_id}?`, l[59].service),
    t('05', 'reasoning', 'Which service produced the most ERROR entries?', topErrSvc),
    t('06', 'reasoning', 'What level is the entry with the highest latency_ms?', slowest.level),
    t('07', 'reasoning', `Did any ERROR occur before 09:00? Answer yes or no.`, errors.some((x) => x.ts.slice(11, 19) < '09:00:00') ? 'yes' : 'no'),
    t('08', 'aggregation', 'How many ERROR entries are there in total?', errors.length, 'number'),
    t('09', 'aggregation', 'How many ERROR entries occurred at or after 12:00:00?', errAfterNoon.length, 'number'),
    t('10', 'aggregation', 'How many entries have status 503?', l.filter((x) => x.status === 503).length, 'number'),
    t('11', 'aggregation', 'How many WARN entries are there?', l.filter((x) => x.level === 'WARN').length, 'number'),
  ];
}

/**
 * Builds all tasks for the given dataset keys, computing ground truth from data.
 * @param {string[]} [keys] Subset of dataset keys (default: all three).
 * @returns {{key: string, data: unknown, tasks: EvalTask[]}[]}
 */
export function buildSuites(keys = ['users', 'config', 'logs']) {
  const builders = { users: usersTasks, config: configTasks, logs: logsTasks };
  return keys.map((key) => {
    const data = loadDataset(key);
    return { key, data, tasks: builders[key](data) };
  });
}

/**
 * Normalizes a model answer for comparison: trims, lowercases, strips wrapping
 * quotes/backticks, trailing punctuation, and collapses whitespace.
 * @param {string} text
 * @returns {string}
 */
export function normalize(text) {
  return String(text)
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[.!]+$/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Scores a raw model answer against a task's ground truth.
 * - number: parses the last numeric token; tolerance 0.05 absolute.
 * - string: normalized exact match, or short-answer containment (the expected
 *   value appears as a whole token and the reply is not a long sentence).
 * @param {EvalTask} task
 * @param {string} rawAnswer
 * @returns {{correct: boolean, got: string}}
 */
export function scoreAnswer(task, rawAnswer) {
  const got = normalize(rawAnswer ?? '');
  if (task.match === 'number') {
    const nums = got.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g);
    const val = nums ? parseFloat(nums[nums.length - 1]) : NaN;
    return { correct: Number.isFinite(val) && Math.abs(val - Number(task.expected)) <= 0.05, got };
  }
  const want = normalize(String(task.expected));
  if (got === want) return { correct: true, got };
  // Lenient fallback for terse-but-wrapped answers ("the billing service").
  const token = new RegExp(`(^|[^a-z0-9_-])${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9_-])`);
  return { correct: got.length <= want.length + 24 && token.test(got), got };
}
