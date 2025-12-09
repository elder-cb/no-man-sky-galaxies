#!/usr/bin/env node
/*
  Validates that all generated galaxy links resolve successfully.
  Rules:
  - URL is built exactly like the app: `https://nomanssky.fandom.com/wiki/` + name with spaces replaced by `_`.
  - Performs an HTTP request (HEAD preferred, fallback to GET on 405/403), follows redirects.
  - Times out per request; limited concurrency and start-time throttling to avoid overloading the remote.
  - Exits with code 1 if any link is invalid.
*/

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const GALAXIES_PATH = path.join(ROOT, 'src', 'assets', 'galaxies.json');
const BASE = 'https://nomanssky.fandom.com/wiki/';

// Tunables (can be overridden with env vars):
const MAX_CONCURRENCY = parseInt(process.env.VALIDATE_MAX_CONCURRENCY || '8', 10);
const REQUEST_TIMEOUT_MS = parseInt(process.env.VALIDATE_REQUEST_TIMEOUT_MS || '10000', 10); // per hop
const MAX_REDIRECTS = parseInt(process.env.VALIDATE_MAX_REDIRECTS || '5', 10);
// Batch processing to keep a lid on bursts
const BATCH_SIZE = parseInt(process.env.VALIDATE_BATCH_SIZE || '10', 10);
const BATCH_PAUSE_MS = parseInt(process.env.VALIDATE_BATCH_PAUSE_MS || '750', 10);
// Throttle: ensure a minimum delay between starting individual requests (global), in ms
// This complements concurrency limiting; defaults to ~3 req/s
const MIN_START_INTERVAL_MS = parseInt(process.env.VALIDATE_MIN_INTERVAL_MS || '300', 10);

function buildUrlFromName(name) {
  // Match the app logic exactly: replace spaces with underscores
  const suffix = (name || '').split(' ').join('_');
  return BASE + suffix;
}

function requestOnce(url, { method = 'HEAD', timeout = REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.request(url, { method, headers: { 'User-Agent': 'link-validator/1.0' } }, (res) => {
      resolve({ ok: true, statusCode: res.statusCode || 0, headers: res.headers });
      res.resume(); // discard any body
    });
    req.setTimeout(timeout, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', (err) => resolve({ ok: false, error: err }));
    req.end();
  });
}

async function checkUrl(url) {
  // Follow redirects up to MAX_REDIRECTS; prefer HEAD; fallback to GET when needed
  let currentUrl = url;
  let redirects = 0;
  let last = null;
  let method = 'HEAD';
  while (redirects <= MAX_REDIRECTS) {
    last = await requestOnce(currentUrl, { method });
    if (!last.ok) return { url: currentUrl, valid: false, reason: last.error?.message || 'request failed' };
    const status = last.statusCode;
    if (status >= 200 && status < 300) return { url: currentUrl, valid: true };
    if (status === 405 || status === 403) {
      // Some servers disallow HEAD; try GET once
      if (method === 'HEAD') {
        method = 'GET';
        continue;
      }
    }
    if (status >= 300 && status < 400 && last.headers && last.headers.location) {
      const loc = last.headers.location;
      // resolve relative redirects
      try {
        currentUrl = new URL(loc, currentUrl).toString();
      } catch {
        return { url: currentUrl, valid: false, reason: 'invalid redirect location' };
      }
      redirects++;
      // Reset method to HEAD on redirect
      method = 'HEAD';
      continue;
    }
    // Any other status code is considered invalid
    return { url: currentUrl, valid: false, reason: `HTTP ${status}` };
  }
  return { url: currentUrl, valid: false, reason: 'too many redirects' };
}

function pLimit(concurrency) {
  let activeCount = 0;
  const queue = [];
  const next = () => {
    if (queue.length === 0) return;
    if (activeCount >= concurrency) return;
    activeCount++;
    const { fn, resolve, reject } = queue.shift();
    fn().then((v) => { activeCount--; resolve(v); next(); }).catch((e) => { activeCount--; reject(e); next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Global start-time throttler: spaces out the start of outbound requests
function makeStartThrottler(minIntervalMs) {
  let lastStart = 0;
  // Chain ensures callers line up for spacing, while requests still run concurrently after they start
  let chain = Promise.resolve();
  return function waitForTurn() {
    chain = chain.then(async () => {
      const now = Date.now();
      const wait = Math.max(0, lastStart + minIntervalMs - now);
      if (wait > 0) {
        // add a tiny jitter (0-50ms) to avoid lockstep patterns
        const jitter = Math.floor(Math.random() * 50);
        await sleep(wait + jitter);
      }
      lastStart = Date.now();
    });
    return chain;
  };
}

async function main() {
  const raw = fs.readFileSync(GALAXIES_PATH, 'utf-8');
  const json = JSON.parse(raw);
  const list = Array.isArray(json.galaxies) ? json.galaxies : [];
  if (list.length === 0) {
    console.error('No galaxies found in assets.');
    process.exit(1);
  }
  console.error(`Validating ${list.length} galaxies...`);

  // Progress indicator
  const total = list.length;
  let completed = 0;
  const isTTY = process.stderr.isTTY;
  const printProgress = () => {
    const pct = Math.floor((completed / total) * 100);
    if (isTTY) {
      process.stderr.write(`\rProgress: ${completed}/${total} (${pct}%)`);
    } else if (completed % 25 === 0 || completed === total) {
      console.error(`Progress: ${completed}/${total} (${pct}%)`);
    }
  };
  if (isTTY) process.stderr.write('\n');

  const limiter = pLimit(MAX_CONCURRENCY);
  const waitForTurn = makeStartThrottler(MIN_START_INTERVAL_MS);
  const results = [];
  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE);
    const tasks = batch.map((g) => {
      const name = g.name || '';
      const url = buildUrlFromName(name);
      return limiter(() => waitForTurn()
        .then(() => checkUrl(url))
        .then(r => {
          completed++;
          printProgress();
          return ({ id: g.id, name, url, ...r });
        }));
    });
    const batchResults = await Promise.all(tasks);
    results.push(...batchResults);
    if (i + BATCH_SIZE < list.length) {
      await sleep(BATCH_PAUSE_MS);
    }
  }
  if (isTTY) process.stderr.write('\n');
  const invalid = results.filter(r => !r.valid);

  if (invalid.length) {
    console.error(`\nInvalid links (${invalid.length}):`);
    invalid.slice(0, 50).forEach((r) => {
      console.error(`- [${r.id}] ${r.name} -> ${r.url} :: ${r.reason}`);
    });
    if (invalid.length > 50) {
      console.error(`... and ${invalid.length - 50} more`);
    }
    process.exit(1);
  }

  console.log(`All ${results.length} galaxy links are valid.`);
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
