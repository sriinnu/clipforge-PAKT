/**
 * One-off deterministic dataset generator (seeded LCG).
 *
 * Provenance only: the three JSON datasets in this directory were produced by
 * running `node scripts/eval/datasets/generate.mjs` once and committing the
 * output. The eval harness (run.mjs) never invokes this file — datasets are
 * fixed so ground truths cannot drift. All data is synthetic; no real PII.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));

// Deterministic LCG so re-running reproduces the exact same files.
let seed = 1337;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

// ---------- tabular-users.json: 50 records x 8 columns ----------
const FIRST = ['Asha','Ben','Carla','Dev','Elena','Farid','Grace','Hugo','Iris','Jonas','Kavya','Liam','Meera','Noah','Oona','Pavel','Quinn','Ravi','Sara','Tomas','Uma','Viktor','Wendy','Xander','Yara','Zane'];
const LAST = ['Rao','Kim','Mendes','Patel','Sorokin','Haddad','Liu','Berger','Novak','Eriksen','Iyer','Walsh','Krishnan','Fischer','Byrne','Sokolov','Marsh','Varma','Lindqvist','Costa'];
const CITIES = ['Austin','Berlin','Chennai','Dublin','Lisbon','Osaka','Toronto'];
const PLANS = ['free','free','free','pro','pro','enterprise'];

const users = [];
const seen = new Set();
for (let id = 1; id <= 50; id++) {
  let fn, ln, key;
  do { fn = pick(FIRST); ln = pick(LAST); key = fn + ln; } while (seen.has(key));
  seen.add(key);
  const year = pick([2023, 2023, 2024, 2024, 2024, 2025]);
  users.push({
    id,
    name: `${fn} ${ln}`,
    email: `${fn.toLowerCase()}.${ln.toLowerCase()}@northwindlabs.dev`,
    age: int(19, 63),
    city: pick(CITIES),
    plan: pick(PLANS),
    signup_date: `${year}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
    active: rnd() > 0.3,
  });
}
// Post-process: guarantee a unique oldest user and a unique most-common city,
// so reasoning tasks have a single unambiguous answer.
users[36].age = 64;
const cityCount = {};
for (const u of users) cityCount[u.city] = (cityCount[u.city] || 0) + 1;
const sortedCities = Object.entries(cityCount).sort((a, b) => b[1] - a[1]);
if (sortedCities[0][1] === sortedCities[1][1]) users[4].city = sortedCities[0][0];
writeFileSync(join(OUT, 'tabular-users.json'), JSON.stringify(users, null, 2) + '\n');

// ---------- nested-config.json: hand-authored nested service config ----------
const config = {
  environment: 'staging',
  region: 'eu-central-1',
  version: '2.14.3',
  global: {
    log_format: 'json',
    tracing: { enabled: true, sampler: 'parentbased_traceidratio', ratio: 0.25 },
    metrics: { enabled: true, exporter: 'prometheus', port: 9090 },
    tls: { min_version: '1.2', cert_rotation_days: 30 },
  },
  services: {
    'api-gateway': {
      replicas: 4,
      port: 8080,
      timeout_ms: 15000,
      log_level: 'info',
      retries: { enabled: true, max_attempts: 3, backoff_ms: 200 },
      rate_limit: { enabled: true, requests_per_minute: 1200, burst: 200 },
      features: { request_logging: true, cors: true, compression: true },
    },
    auth: {
      replicas: 3,
      port: 8081,
      timeout_ms: 5000,
      log_level: 'warn',
      retries: { enabled: true, max_attempts: 2, backoff_ms: 100 },
      rate_limit: { enabled: true, requests_per_minute: 600, burst: 100 },
      database: { engine: 'postgres', pool: { min: 2, max: 20 }, statement_timeout_ms: 3000 },
      token: { issuer: 'northwindlabs', access_ttl_minutes: 15, refresh_ttl_hours: 72 },
    },
    billing: {
      replicas: 2,
      port: 8082,
      timeout_ms: 30000,
      log_level: 'info',
      retries: { enabled: true, max_attempts: 5, backoff_ms: 500 },
      rate_limit: { enabled: false },
      database: { engine: 'postgres', pool: { min: 1, max: 10 }, statement_timeout_ms: 10000 },
      providers: { primary: 'stripe', fallback: 'adyen', reconcile_cron: '0 3 * * *' },
    },
    search: {
      replicas: 6,
      port: 8083,
      timeout_ms: 2500,
      log_level: 'info',
      retries: { enabled: false, reason: 'idempotency not guaranteed' },
      rate_limit: { enabled: true, requests_per_minute: 3000, burst: 500 },
      index: { engine: 'opensearch', shards: 12, refresh_interval_s: 5 },
      cache: { enabled: true, ttl_seconds: 120, max_entries: 50000 },
    },
    notifications: {
      replicas: 2,
      port: 8084,
      timeout_ms: 10000,
      log_level: 'debug',
      retries: { enabled: true, max_attempts: 4, backoff_ms: 1000 },
      rate_limit: { enabled: true, requests_per_minute: 300, burst: 50 },
      channels: {
        email: { enabled: true, provider: 'ses', from: 'no-reply@northwindlabs.dev' },
        sms: { enabled: false, provider: 'twilio' },
        push: { enabled: true, provider: 'fcm' },
      },
      queue: { engine: 'sqs', visibility_timeout_s: 60, dlq_after_attempts: 6 },
    },
  },
};
writeFileSync(join(OUT, 'nested-config.json'), JSON.stringify(config, null, 2) + '\n');

// ---------- logs.json: 80 structured entries with repeated keys/values ----------
const SERVICES = ['api-gateway', 'auth', 'billing', 'search', 'notifications'];
const MSG = {
  INFO: ['request completed', 'cache hit', 'token issued', 'invoice generated', 'index refreshed'],
  WARN: ['slow query detected', 'retry scheduled', 'rate limit near threshold', 'stale cache entry'],
  ERROR: ['upstream timeout', 'database connection refused', 'payment provider error', 'index write failed'],
  DEBUG: ['payload trace', 'feature flag evaluated'],
};
// Fixed level mix: 14 ERROR, 12 WARN, 4 DEBUG, 50 INFO — deterministically shuffled.
const levels = [
  ...Array(14).fill('ERROR'), ...Array(12).fill('WARN'),
  ...Array(4).fill('DEBUG'), ...Array(50).fill('INFO'),
];
for (let i = levels.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [levels[i], levels[j]] = [levels[j], levels[i]];
}
const logs = [];
let errSeen = 0;
for (let i = 0; i < 80; i++) {
  // Strictly increasing timestamps from 08:00 to ~18:00 on a single day.
  const totalSec = 8 * 3600 + Math.floor((i * (10 * 3600 - 60)) / 80) + int(0, 40);
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  const level = levels[i];
  if (level === 'ERROR') errSeen++;
  // Force the first 6 errors onto billing so "most ERRORs" has a unique answer.
  const service = level === 'ERROR' && errSeen <= 6 ? 'billing' : pick(SERVICES);
  logs.push({
    ts: `2026-06-09T${hh}:${mm}:${ss}Z`,
    level,
    service,
    message: pick(MSG[level]),
    status: level === 'ERROR' ? pick([500, 502, 503]) : level === 'WARN' ? pick([200, 429]) : pick([200, 200, 201]),
    latency_ms: level === 'ERROR' ? int(900, 2400) : int(12, 750),
    request_id: `req-${String(1000 + i)}`,
  });
}
// Post-process: guarantee a unique max-latency entry.
let maxIdx = 0;
for (let i = 1; i < logs.length; i++) if (logs[i].latency_ms >= logs[maxIdx].latency_ms) maxIdx = i;
logs[maxIdx].latency_ms = 2873;
writeFileSync(join(OUT, 'logs.json'), JSON.stringify(logs, null, 2) + '\n');

// Sanity summary printed for the human running this once.
const errs = logs.filter((l) => l.level === 'ERROR');
const perSvc = {};
for (const e of errs) perSvc[e.service] = (perSvc[e.service] || 0) + 1;
console.log('users:', users.length, '| oldest:', users.find((u) => u.age === 64).name);
console.log('logs:', logs.length, '| ERROR:', errs.length, '| ERROR after 12:00:', errs.filter((l) => l.ts.slice(11, 13) >= '12').length);
console.log('error per service:', JSON.stringify(perSvc));
