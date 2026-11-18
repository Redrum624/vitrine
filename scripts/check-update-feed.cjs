#!/usr/bin/env node
/**
 * check-update-feed.cjs
 * Read-only check that installed copies can see and verify a published release.
 *
 * Usage: node scripts/check-update-feed.cjs [--version X.Y.Z]
 *   - owner/repo come from package.json build.publish (what installed copies read, via app-update.yml)
 *   - the version defaults to package.json's
 *   - reads `gh release view v<version> --json isDraft,isPrerelease,tagName,assets`, then the feed the
 *     way electron-updater's GitHubProvider does: GET /releases/latest as JSON (the tag), then
 *     GET /releases/download/<tag>/latest.yml (plain https, redirects followed)
 *   - prints one PASS/FAIL line per check; exit 0 when every check passes, else 1
 *
 * Writes nothing, anywhere. gh-release.cjs runs the same checks (checkPublished) after it publishes.
 * The checks themselves are pure and live in release-assets.cjs.
 */
'use strict';

const fs            = require('fs');
const path          = require('path');
const https         = require('https');
const { spawnSync } = require('child_process');
const { readbackChecks, feedChecks } = require('./release-assets.cjs');

const ROOT          = path.join(__dirname, '..');
const TIMEOUT_MS    = 30000; // design value: per request / per gh call
const MAX_REDIRECTS = 5;     // design value: GitHub answers both reads with one or two redirects

/** owner/repo of the GitHub publish target in package.json build.publish (object or array). */
function publishRepo(pkg) {
  const list = [].concat((pkg.build && pkg.build.publish) || []);
  const pub = list.find((p) => p && p.provider === 'github');
  if (!pub || !pub.owner || !pub.repo) {
    throw new Error('package.json build.publish has no github provider with owner and repo');
  }
  return { owner: pub.owner, repo: pub.repo };
}

/** @returns {{ version?: string }} */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--version') out.version = argv[++i];
    else if (a.startsWith('--version=')) out.version = a.slice('--version='.length);
    else throw new Error(`unknown argument ${a} (usage: node scripts/check-update-feed.cjs [--version X.Y.Z])`);
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(out.version || '')) {
      throw new Error(`--version needs X.Y.Z, got ${out.version === undefined ? 'nothing' : out.version}`);
    }
  }
  return out;
}

/** GET with Node's https, following redirects. @returns {Promise<{ status: number, body: string }>} */
function httpsGet(url, headers = {}, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'release-feed-check', ...headers } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) { reject(new Error(`too many redirects from ${url}`)); return; }
        resolve(httpsGet(new URL(res.headers.location, url).toString(), headers, redirectsLeft - 1));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
      res.on('error', reject);
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`no answer from ${url} within ${TIMEOUT_MS / 1000} s`)));
    req.on('error', reject);
  });
}

/** `gh release view <tag> --json ...`, read-only. @returns {{ view?: object, error?: string }} */
function ghReleaseView(tag, repoSlug) {
  const r = spawnSync('gh', ['release', 'view', tag, '--repo', repoSlug, '--json', 'isDraft,isPrerelease,tagName,assets'],
    { encoding: 'utf8', windowsHide: true, timeout: TIMEOUT_MS });
  if (r.error) return { error: `gh could not run: ${r.error.message}` };
  if (r.status !== 0) return { error: `gh release view ${tag} failed: ${(r.stderr || '').trim() || `exit ${r.status}`}` };
  try {
    return { view: JSON.parse(r.stdout) };
  } catch (e) {
    return { error: `gh release view ${tag} printed no JSON (${e.message})` };
  }
}

/**
 * The two reads an installed copy makes. Each read is a check of its own.
 * @returns {Promise<{ latestTag?: string, latestYmlText?: string, checks: Array<{ name: string, error: string|null }> }>}
 */
async function fetchLiveFeed({ owner, repo }) {
  const base = `https://github.com/${owner}/${repo}/releases`;
  const out = { checks: [] };
  const read = async (name, url, headers, take) => {
    try {
      const r = await httpsGet(url, headers);
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      take(r.body);
      out.checks.push({ name, error: null });
      return true;
    } catch (e) {
      out.checks.push({ name, error: `${url}: ${e.message}` });
      return false;
    }
  };
  const gotTag = await read('GET /releases/latest', `${base}/latest`, { Accept: 'application/json' }, (body) => {
    const tag = JSON.parse(body).tag_name;
    if (!tag) throw new Error('the answer has no tag_name');
    out.latestTag = tag;
  });
  if (gotTag) {
    await read(`GET /releases/download/${out.latestTag}/latest.yml`, `${base}/download/${out.latestTag}/latest.yml`,
      { Accept: '*/*' }, (body) => { out.latestYmlText = body; });
  }
  return out;
}

/**
 * Everything gh-release.cjs and this script check on a published release: the read-back of
 * release v<version> and the live feed. installerSize undefined skips the installer size check.
 * @returns {Promise<Array<{ name: string, error: string|null }>>}
 */
async function checkPublished({ owner, repo, version, installerName, installerSize }) {
  const tag = `v${version}`;
  const checks = [];
  const { view, error } = ghReleaseView(tag, `${owner}/${repo}`);
  checks.push({ name: `gh release view ${tag} --repo ${owner}/${repo}`, error: error || null });
  if (view) checks.push(...readbackChecks(view, { version, installerName, installerSize }));
  const feed = await fetchLiveFeed({ owner, repo });
  checks.push(...feed.checks);
  if (feed.latestTag !== undefined) {
    const fc = feedChecks({ latestTag: feed.latestTag, latestYmlText: feed.latestYmlText, view, version });
    // Without latest.yml only the tag check means anything; the fetch line above already failed.
    checks.push(...(feed.latestYmlText === undefined ? fc.filter((c) => c.name.startsWith('/releases/latest')) : fc));
  }
  return checks;
}

const formatCheck = (c) => (c.error ? `FAIL ${c.name}: ${c.error}` : `PASS ${c.name}`);

async function main(argv) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = parseArgs(argv).version || pkg.version;
  const { owner, repo } = publishRepo(pkg);
  const checks = await checkPublished({ owner, repo, version });
  for (const c of checks) console.log(formatCheck(c));
  return checks.some((c) => c.error) ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e) => { console.log(`FAIL ${e.message}`); process.exitCode = 1; },
  );
}

module.exports = { publishRepo, parseArgs, httpsGet, ghReleaseView, fetchLiveFeed, checkPublished, formatCheck };
