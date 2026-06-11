/**
 * Task definitions + answer scoring for the PAKT comprehension eval.
 *
 * Ground truths are COMPUTED from the committed datasets at load time (never
 * hardcoded), so they cannot drift from the data. Categories:
 *   - extraction:  point lookup of a single field via a UNIQUE key attribute
 *   - relational:  single-hop join when the linking key is unique
 *   - boolean:     yes/no existence or property test
 *   - count:       trivial count over ≤8 rows (never multi-row aggregation)
 *
 * Two suites:
 *   buildComprehensionSuites()  — default; 6–8 row payloads, retrieval-light
 *                                 questions. Isolates format-reading ability.
 *   buildSuites()               — legacy "stress" suite; 50-80 row payloads
 *                                 with reasoning + aggregation tasks.
 *                                 Format-confounded by retrieval/arithmetic noise.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATASETS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'datasets');

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} EvalTask
 * @property {string} id            Stable task id (e.g. "su-01").
 * @property {string} dataset       Dataset key.
 * @property {"extraction"|"relational"|"boolean"|"count"|"reasoning"|"aggregation"} category
 * @property {string} question      Question shown to the model.
 * @property {string|number} expected  Ground-truth answer computed from data.
 * @property {"string"|"number"} match  Scoring mode.
 */

// ─── Dataset loaders ─────────────────────────────────────────────────────────

/**
 * Loads a committed dataset by key.
 * Supports both stress-suite keys ("users", "config", "logs") and
 * comprehension-suite keys ("small-users", "small-config", "small-events").
 * @param {string} key
 * @returns {unknown} Parsed JSON data.
 */
export function loadDataset(key) {
  const files = {
    users: 'tabular-users.json',
    config: 'nested-config.json',
    logs: 'logs.json',
    'small-users': 'small-users.json',
    'small-config': 'small-config.json',
    'small-events': 'small-events.json',
  };
  const file = files[key];
  if (!file) throw new Error(`Unknown dataset: ${key}`);
  return JSON.parse(readFileSync(join(DATASETS_DIR, file), 'utf8'));
}

// ─── Comprehension-suite task builders ───────────────────────────────────────

/**
 * Builds comprehension tasks for the small-users dataset.
 * 7 records — all unique names, cities, plans. Questions are retrieval-light:
 * direct extraction by unique name/city, boolean existence, tiny counts.
 *
 * @param {Array<{id:number,name:string,email:string,city:string,plan:string,age:number,active:boolean}>} u
 * @returns {EvalTask[]}
 */
function smallUsersTasks(u) {
  const byName = (name) => u.find((x) => x.name === name);
  const byCity = (city) => u.find((x) => x.city === city);

  // Derived facts — computed from data, never hand-typed.
  const oldest = u.reduce((a, b) => (b.age > a.age ? b : a));
  const activeFreeCount = u.filter((x) => x.active && x.plan === 'free').length;
  const enterpriseCount = u.filter((x) => x.plan === 'enterprise').length;
  const anyOver60 = u.some((x) => x.age > 60) ? 'yes' : 'no';

  /** @param {string} id @param {string} cat @param {string} q @param {string|number} exp @param {"string"|"number"} [m] */
  const t = (id, cat, q, exp, m = 'string') =>
    ({ id: `su-${id}`, dataset: 'small-users', category: cat, question: q, expected: exp, match: m });

  return [
    t('01', 'extraction',  'What is the email address of Quinn Achebe?',                          byName('Quinn Achebe').email),
    t('02', 'extraction',  'What is the age of Seun Nakamura?',                                   byName('Seun Nakamura').age, 'number'),
    t('03', 'extraction',  'What plan is Lena Okafor on?',                                        byName('Lena Okafor').plan),
    t('04', 'extraction',  'What city does Takeshi Brandt live in?',                              byName('Takeshi Brandt').city),
    t('05', 'relational',  'What is the email address of the user in Nairobi?',                   byCity('Nairobi').email),
    t('06', 'relational',  'What plan is the Tallinn user on?',                                   byCity('Tallinn').plan),
    t('07', 'boolean',     'Is Priya Delacroix currently active? Answer yes or no.',              byName('Priya Delacroix').active ? 'yes' : 'no'),
    t('08', 'boolean',     'Is there any user older than 60? Answer yes or no.',                  anyOver60),
    t('09', 'boolean',     'Is Boris Castellano active? Answer yes or no.',                       byName('Boris Castellano').active ? 'yes' : 'no'),
    t('10', 'count',       'How many users are on the enterprise plan?',                          enterpriseCount, 'number'),
    t('11', 'count',       'How many users are both active and on the free plan?',                activeFreeCount, 'number'),
    t('12', 'extraction',  'What is the name of the oldest user?',                               oldest.name),
  ];
}

/**
 * Builds comprehension tasks for the small-config dataset.
 * Compact 4-service config. Questions test reading of flat and single-nested
 * values — no multi-hop traversal required.
 *
 * @param {{environment:string, services:Record<string,{port:number,timeout_ms:number,retries:number,tls:boolean}>, feature_flags:Record<string,boolean>, limits:{max_upload_mb:number,session_ttl_minutes:number,rate_limit_rps:number}}} c
 * @returns {EvalTask[]}
 */
function smallConfigTasks(c) {
  const svcs = c.services;
  const tlsEnabled = Object.keys(svcs).filter((n) => svcs[n].tls === true);
  const zeroRetries = Object.keys(svcs).find((n) => svcs[n].retries === 0);
  const highestTimeout = Object.keys(svcs).reduce((a, b) =>
    svcs[b].timeout_ms > svcs[a].timeout_ms ? b : a,
  );
  const disabledFlags = Object.keys(c.feature_flags).filter((f) => !c.feature_flags[f]);

  /** @param {string} id @param {string} cat @param {string} q @param {string|number} exp @param {"string"|"number"} [m] */
  const t = (id, cat, q, exp, m = 'string') =>
    ({ id: `sc-${id}`, dataset: 'small-config', category: cat, question: q, expected: exp, match: m });

  return [
    t('01', 'extraction', 'What is the port of the mailer service?',                             svcs.mailer.port, 'number'),
    t('02', 'extraction', 'What is the timeout_ms of the inventory service?',                    svcs.inventory.timeout_ms, 'number'),
    t('03', 'extraction', 'What is the environment this config is for?',                         c.environment),
    t('04', 'extraction', 'What is the session_ttl_minutes limit?',                              c.limits.session_ttl_minutes, 'number'),
    t('05', 'extraction', 'How many retries is the mailer service configured for?',              svcs.mailer.retries, 'number'),
    t('06', 'relational', 'Which service has zero retries configured?',                          zeroRetries),
    t('07', 'relational', 'Which service has the highest timeout_ms?',                           highestTimeout),
    t('08', 'boolean',    'Is TLS enabled on the gateway service? Answer yes or no.',            svcs.gateway.tls ? 'yes' : 'no'),
    t('09', 'boolean',    'Is the beta_checkout feature flag enabled? Answer yes or no.',        c.feature_flags.beta_checkout ? 'yes' : 'no'),
    t('10', 'boolean',    'Is the new_search feature flag enabled? Answer yes or no.',           c.feature_flags.new_search ? 'yes' : 'no'),
    t('11', 'count',      'How many services have TLS enabled?',                                 tlsEnabled.length, 'number'),
    t('12', 'count',      'How many feature flags are disabled (set to false)?',                 disabledFlags.length, 'number'),
  ];
}

/**
 * Builds comprehension tasks for the small-events dataset.
 * 8 structured log entries with distinct IDs, timestamps, and messages.
 * Questions are keyed by the unique evt-id or unique service+message combos.
 *
 * @param {Array<{id:string,ts:string,level:string,service:string,message:string,latency_ms:number}>} evts
 * @returns {EvalTask[]}
 */
function smallEventsTasks(evts) {
  const byId = (id) => evts.find((x) => x.id === id);
  const errors = evts.filter((x) => x.level === 'ERROR');
  const warns = evts.filter((x) => x.level === 'WARN');
  const slowest = evts.reduce((a, b) => (b.latency_ms > a.latency_ms ? b : a));
  const anyErrorBefore10 = errors.some((x) => x.ts.slice(11, 13) < '10') ? 'yes' : 'no';

  /** @param {string} id @param {string} cat @param {string} q @param {string|number} exp @param {"string"|"number"} [m] */
  const t = (id, cat, q, exp, m = 'string') =>
    ({ id: `se-${id}`, dataset: 'small-events', category: cat, question: q, expected: exp, match: m });

  return [
    t('01', 'extraction', 'What is the message of the event with id evt-003?',                  byId('evt-003').message),
    t('02', 'extraction', 'What service produced event evt-006?',                               byId('evt-006').service),
    t('03', 'extraction', 'What is the latency_ms of event evt-004?',                           byId('evt-004').latency_ms, 'number'),
    t('04', 'extraction', 'What is the timestamp (ts) of event evt-001?',                       byId('evt-001').ts),
    t('05', 'extraction', 'What level is event evt-007?',                                       byId('evt-007').level),
    t('06', 'relational', 'What is the message of the event with the highest latency_ms?',       slowest.message),
    t('07', 'relational', 'What is the level of the event with id evt-005?',                    byId('evt-005').level),
    t('08', 'boolean',    'Is there any ERROR event before 10:00? Answer yes or no.',           anyErrorBefore10),
    t('09', 'boolean',    'Does event evt-008 have a level of WARN? Answer yes or no.',         byId('evt-008').level === 'WARN' ? 'yes' : 'no'),
    t('10', 'count',      'How many ERROR events are there?',                                   errors.length, 'number'),
    t('11', 'count',      'How many WARN events are there?',                                    warns.length, 'number'),
    t('12', 'count',      'How many events are from the mailer service?',                       evts.filter((x) => x.service === 'mailer').length, 'number'),
  ];
}

// ─── Stress-suite task builders (original 50/80-row datasets) ────────────────

/** @param {Array<Record<string, any>>} u Users dataset. @returns {EvalTask[]} */
function usersTasks(u) {
  const byId = (id) => u.find((x) => x.id === id);
  const oldest = u.reduce((a, b) => (b.age > a.age ? b : a));
  const cityCount = {};
  for (const x of u) cityCount[x.city] = (cityCount[x.city] || 0) + 1;
  const topCity = Object.entries(cityCount).sort((a, b) => b[1] - a[1])[0][0];
  const avgAge = Math.round((u.reduce((s, x) => s + x.age, 0) / u.length) * 10) / 10;
  const t = (id, cat, q, exp, m = 'string') =>
    ({ id: `users-${id}`, dataset: 'users', category: cat, question: q, expected: exp, match: m });
  return [
    t('01', 'extraction',  'What is the email address of the user with id 23?',                  byId(23).email),
    t('02', 'extraction',  'What city does the user with id 41 live in?',                        byId(41).city),
    t('03', 'extraction',  `What plan is ${byId(7).name} (id 7) on?`,                            byId(7).plan),
    t('04', 'extraction',  'What is the signup_date of the user with id 50?',                    byId(50).signup_date),
    t('05', 'reasoning',   'What is the name of the oldest user?',                               oldest.name),
    t('06', 'reasoning',   'Which city has the most users?',                                     topCity),
    t('07', 'reasoning',   'Is the user with id 12 active? Answer yes or no.',                   byId(12).active ? 'yes' : 'no'),
    t('08', 'aggregation', 'How many users are on the enterprise plan?',                         u.filter((x) => x.plan === 'enterprise').length, 'number'),
    t('09', 'aggregation', 'How many users are active (active = true)?',                         u.filter((x) => x.active).length, 'number'),
    t('10', 'aggregation', 'How many users signed up in 2024 (signup_date starting with 2024)?', u.filter((x) => x.signup_date.startsWith('2024')).length, 'number'),
    t('11', 'aggregation', 'What is the average age of all users, rounded to 1 decimal place?',  avgAge, 'number'),
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
  const t = (id, cat, q, exp, m = 'string') =>
    ({ id: `config-${id}`, dataset: 'config', category: cat, question: q, expected: exp, match: m });
  return [
    t('01', 'extraction',  'What is the max_attempts value for the billing service retries?',    svcs.billing.retries.max_attempts, 'number'),
    t('02', 'extraction',  'What is the timeout_ms of the search service?',                      svcs.search.timeout_ms, 'number'),
    t('03', 'extraction',  'What is the database pool max for the auth service?',                svcs.auth.database.pool.max, 'number'),
    t('04', 'extraction',  'What is the log_level of the notifications service?',               svcs.notifications.log_level),
    t('05', 'extraction',  'Which environment is this configuration for?',                       c.environment),
    t('06', 'reasoning',   'Which service has retries disabled?',                                retriesOff[0]),
    t('07', 'reasoning',   'Which service has the most replicas?',                               mostReplicas),
    t('08', 'reasoning',   'Is global tracing enabled? Answer yes or no.',                       c.global.tracing.enabled ? 'yes' : 'no'),
    t('09', 'reasoning',   'Which notification channel is disabled?',                            Object.keys(svcs.notifications.channels).find((k) => !svcs.notifications.channels[k].enabled)),
    t('10', 'aggregation', 'How many services have rate limiting enabled?',                      rateLimited.length, 'number'),
    t('11', 'aggregation', 'What is the total number of replicas across all services?',          totalReplicas, 'number'),
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
  const t = (id, cat, q, exp, m = 'string') =>
    ({ id: `logs-${id}`, dataset: 'logs', category: cat, question: q, expected: exp, match: m });
  return [
    t('01', 'extraction',  'What is the request_id of the log entry with the highest latency_ms?',  slowest.request_id),
    t('02', 'extraction',  `What is the message of the entry with request_id ${errors[0].request_id}?`, errors[0].message),
    t('03', 'extraction',  'What is the timestamp (ts) of the first ERROR entry?',                 errors[0].ts),
    t('04', 'extraction',  `Which service produced the entry with request_id ${l[59].request_id}?`, l[59].service),
    t('05', 'reasoning',   'Which service produced the most ERROR entries?',                        topErrSvc),
    t('06', 'reasoning',   'What level is the entry with the highest latency_ms?',                 slowest.level),
    t('07', 'reasoning',   'Did any ERROR occur before 09:00? Answer yes or no.',                   errors.some((x) => x.ts.slice(11, 19) < '09:00:00') ? 'yes' : 'no'),
    t('08', 'aggregation', 'How many ERROR entries are there in total?',                           errors.length, 'number'),
    t('09', 'aggregation', 'How many ERROR entries occurred at or after 12:00:00?',                errAfterNoon.length, 'number'),
    t('10', 'aggregation', 'How many entries have status 503?',                                    l.filter((x) => x.status === 503).length, 'number'),
    t('11', 'aggregation', 'How many WARN entries are there?',                                     l.filter((x) => x.level === 'WARN').length, 'number'),
  ];
}

// ─── Public suite builders ────────────────────────────────────────────────────

/**
 * Builds the comprehension suite — small payloads (6–8 rows), retrieval-light
 * questions keyed by UNIQUE attributes. This is the DEFAULT suite.
 *
 * Every question is answerable by careful reading of a small fully-visible
 * payload, so failures isolate format-reading ability rather than
 * retrieval/arithmetic capacity. The matched-pair comparison in report.mjs
 * operates on this suite by default.
 *
 * @param {string[]} [keys] Subset: "small-users" | "small-config" | "small-events".
 * @returns {{key: string, data: unknown, tasks: EvalTask[]}[]}
 */
export function buildComprehensionSuites(keys = ['small-users', 'small-config', 'small-events']) {
  const builders = {
    'small-users': smallUsersTasks,
    'small-config': smallConfigTasks,
    'small-events': smallEventsTasks,
  };
  return keys.map((key) => {
    if (!builders[key]) throw new Error(`buildComprehensionSuites: unknown key "${key}"`);
    const data = loadDataset(key);
    return { key, data, tasks: builders[key](data) };
  });
}

/**
 * Builds the stress suite — original 50/80-row datasets with cross-row
 * reasoning + aggregation tasks. Kept for regression coverage. NOTE: these
 * tasks are format-confounded by retrieval difficulty and arithmetic; accuracy
 * differences here reflect LLM limitations, not PAKT format legibility.
 *
 * @param {string[]} [keys] Subset: "users" | "config" | "logs".
 * @returns {{key: string, data: unknown, tasks: EvalTask[]}[]}
 */
export function buildSuites(keys = ['users', 'config', 'logs']) {
  const builders = { users: usersTasks, config: configTasks, logs: logsTasks };
  return keys.map((key) => {
    const data = loadDataset(key);
    return { key, data, tasks: builders[key](data) };
  });
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

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
  const token = new RegExp(`(^|[^a-z0-9_@.-])${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9_@.-])`);
  return { correct: got.length <= want.length + 24 && token.test(got), got };
}
