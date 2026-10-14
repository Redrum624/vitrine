'use strict';

/**
 * update-e2e: Vitrine's update path, end to end, against a feed on 127.0.0.1 (docs/UPDATES.md, "Verify locally").
 * Windows only. Ported (trimmed) from desktop-starter's scripts/update-e2e.cjs.
 *
 *   node scripts/update-e2e.cjs --answer now|later|manual [--stage all|build|test] [--work <dir>] [--keep]
 *   node scripts/update-e2e.cjs --preflight [--work <dir>]
 *
 * One run, in order:
 *   1. Copies the repository's tracked files (git ls-files) into <work>\app and gives the copy a test identity:
 *      package name, productName, appId, shortcut and artifact names become update-e2e / Update E2E /
 *      com.updatee2e.app, and every `photo_app`, `com.photoeditorpro.app` and `Photo Editor Pro` in the copy's text
 *      files becomes the test identity (electron/main.cjs pins userData with app.setName('photo_app') and logs to
 *      ~/Photo Editor Pro: without this the copy would read and write the real install's data). The run refuses to
 *      build while any of those strings is left. The AI model weights (git-ignored, ~130 MB) are not copied: they
 *      play no part in updating.
 *   2. Points build.publish at a generic feed on http://127.0.0.1:<free port>/, installs dependencies
 *      (--frozen-lockfile) and builds 0.1.0 (installer + portable) into <work>\A, then 0.1.1 (installer) into
 *      <work>\B. Build steps are idempotent: a rerun with --stage build skips what exists.
 *   3. Serves latest.yml, the 0.1.1 installer and its blockmap from <work>\B (bound to 127.0.0.1). Starts the 0.1.0
 *      PORTABLE exe first and checks it logs `disabled-portable` and that the feed saw no request. Then installs
 *      0.1.0 silently for the current user into <work>\install and starts it.
 *   4. Waits for the installed copy to find, download and offer 0.1.1, then answers the "Update ready" box through
 *      Windows UI Automation (scripts/ui-answer.ps1), or, with --answer manual, waits for a person.
 *   5. now: the app quits, the installer runs silently and starts the installed exe again as 0.1.1.
 *      later: a normal close (taskkill without /F) makes electron-updater install 0.1.1 at quit; a new start then
 *      logs `started ... 0.1.1`, `update not available`.
 *   6. Teardown, always: stops every process whose executable is under <work> (by path, killed by PID), closes the
 *      feed, uninstalls, removes %APPDATA%\update-e2e, %LOCALAPPDATA%\update-e2e-updater, ~\Update E2E and <work>
 *      (unless --keep), then checks that none of it is left.
 *
 * --stage build stops after step 2 and keeps <work>; --stage test (with the same --work) runs steps 3-6 on those
 * builds, so the long builds fit in separate foreground calls and `--answer now` and `--answer later` share them.
 *
 * Nothing here ever names the real install: it never kills by image name, and the test identity (exe name, GUID,
 * userData, updater cache) cannot collide with it. The run refuses to start while any of its folders or keys exist.
 *
 * Exit codes: 0 every check passed, the teardown's included; 1 a check failed, or the run was stopped;
 * 2 a usage error, or a refusal before anything was installed.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const UI_ANSWER = path.join(__dirname, 'ui-answer.ps1');

const USAGE = [
  'Usage: node scripts/update-e2e.cjs --answer now|later|manual [--stage all|build|test] [--work <dir>] [--keep]',
  '       node scripts/update-e2e.cjs --preflight [--work <dir>]',
].join('\n');

/** The test build's identity: never a real app's, so a test install collides with nothing. */
const IDENTITY = Object.freeze({ name: 'update-e2e', product: 'Update E2E', appId: 'com.updatee2e.app' });
const OLD_VERSION = '0.1.0';
const NEW_VERSION = '0.1.1';
const FEED_HOST = '127.0.0.1';

// The strings the copy must not keep: the real app's identity.
const REAL_TOKENS = Object.freeze([
  ['com.photoeditorpro.app', IDENTITY.appId],
  ['photo_app', IDENTITY.name],
  ['Photo Editor Pro', IDENTITY.product],
]);
const TEXT_EXTENSIONS = new Set(['.cjs', '.js', '.mjs', '.ts', '.tsx', '.json', '.md', '.html', '.yml', '.yaml', '.py', '.nsh', '.txt', '.css', '.ps1']);

// app-builder-lib NsisTarget.js (ELECTRON_BUILDER_NS_UUID): the namespace of the NSIS GUID.
const NSIS_NAMESPACE = '50e065bc-3134-11e6-9bab-38c9862bdaf3';
const UNINSTALL_ROOT = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
const CACHE_MARKER = 'update-e2e-marker.txt';

// electron/updater.cjs prompt(): the box's title and its two buttons.
const PROMPT_TITLE = 'Update ready';
const BUTTONS = Object.freeze({ now: 'Restart and install now', later: 'Later' });
const ANSWERS = Object.freeze(['now', 'later', 'manual']);
const STAGES = Object.freeze(['all', 'build', 'test']);

// Upper bounds on waiting. They are declared, not measured: a wait that runs out fails the run.
const DOWNLOAD_WAIT_MS = 180000;
const RELAUNCH_WAIT_MS = 180000;
const REGISTRY_WAIT_MS = 180000;
const UI_ANSWER_WAIT_S = 30;
const MANUAL_WAIT_MS = 600000;
const LOG_LINE_WAIT_MS = 30000;
const EXIT_WAIT_MS = 60000;
const INSTALL_WAIT_MS = 180000;
const INSTALLER_DONE_WAIT_MS = 180000;
const WINDOW_WAIT_MS = 30000;
const KILL_WAIT_MS = 30000;
const SOCKET_DRAIN_MS = 5000;
const PORTABLE_WAIT_MS = 120000;
const BUILD_STEP_MS = 540000;
const POLL_MS = 500;

class UsageError extends Error {}
/** A reason not to start. Nothing on the profile has been touched when one is thrown. */
class Refusal extends Error {}
/** A failed check that ends the run (already recorded). */
class CheckFailed extends Error {}
/** SIGINT and the like, or a crash: the run stops at its next wait, and the teardown runs. */
class Aborted extends Error {}

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function firstLine(value) {
  const text = value instanceof Error ? value.stack || value.message : String(value ?? '');
  const line = text.split(/\r?\n/).find((l) => l.trim() !== '');
  return line === undefined ? '' : line.trim();
}

function isInsideOrEqual(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function realpathOrResolved(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

const samePath = (a, b) => nonEmpty(a) && nonEmpty(b) && path.relative(path.resolve(a), path.resolve(b)) === '';
const withSep = (dir) => (dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`);

/** Whether a path exists. Only "no such file" means no: any other error is thrown, never read as absence. */
function pathExists(file) {
  try {
    fs.statSync(file);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return false;
    throw err;
  }
}

function fileSize(file) {
  try {
    return fs.statSync(file).size;
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
}

async function removeDir(dir) {
  await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}

// ---------------------------------------------------------------------------------------------------------------
// Arguments

function parseArgs(argv) {
  const options = { answer: null, work: null, stage: null, keep: false, preflight: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--answer' || arg === '--work' || arg === '--stage') {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      if (options[key] !== null) throw new UsageError(`${arg} was given twice`);
      if (key === 'answer' && !ANSWERS.includes(value)) throw new UsageError(`--answer must be one of ${ANSWERS.join(', ')}, got ${JSON.stringify(value)}`);
      if (key === 'stage' && !STAGES.includes(value)) throw new UsageError(`--stage must be one of ${STAGES.join(', ')}, got ${JSON.stringify(value)}`);
      options[key] = value;
      i += 1;
      continue;
    }
    if (arg === '--keep' || arg === '--preflight') {
      options[arg.slice(2)] = true;
      continue;
    }
    throw new UsageError(`unknown argument ${JSON.stringify(arg)}`);
  }
  if (options.stage === null) options.stage = 'all';
  if (options.answer === null && !options.preflight && options.stage !== 'build') throw new UsageError(`--answer is required: ${ANSWERS.join(', ')}`);
  if (options.stage !== 'all' && options.work === null) throw new UsageError('--stage build|test needs --work <dir>');
  return options;
}

// ---------------------------------------------------------------------------------------------------------------
// The copy's identity

/** The GUID electron-builder derives from build.appId for the NSIS keys: UUID v5 in the builder's namespace. */
function nsisGuid(appId) {
  const hash = crypto.createHash('sha1').update(Buffer.from(NSIS_NAMESPACE.replace(/-/g, ''), 'hex')).update(appId).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** The packaged executable's base name, by electron-builder's precedence. NSIS names the uninstaller after it. */
function productFilename(pkg) {
  const build = pkg.build || {};
  const win = build.win || {};
  return win.executableName ?? build.executableName ?? (build.productName || pkg.productName || pkg.name);
}

/** electron-builder's updaterCacheDirName: package.json name, lower-cased, plus "-updater". */
function updaterCacheDirName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`the package name ${JSON.stringify(name)} would need sanitising`);
  return `${name.toLowerCase()}-updater`;
}

/** The copy's package.json with version, build.publish and the test identity. */
function applyPackageJson(appDir, { version, feedUrl }) {
  const file = path.join(appDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!isObject(pkg.build)) throw new Error('package.json has no build object');
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/$/.test(feedUrl)) throw new Error(`the feed must be http://127.0.0.1:<port>/, got ${feedUrl}`);
  const build = pkg.build;
  const nsis = isObject(build.nsis) ? build.nsis : {};
  if (nsis.perMachine === true) throw new Refusal('build.nsis.perMachine is true: this check installs for the current user only');
  pkg.name = IDENTITY.name;
  pkg.productName = IDENTITY.product;
  pkg.version = version;
  build.productName = IDENTITY.product;
  build.appId = IDENTITY.appId;
  build.win = { ...(isObject(build.win) ? build.win : {}), artifactName: 'Update-E2E-Setup-${version}.${ext}' };
  build.portable = { ...(isObject(build.portable) ? build.portable : {}), artifactName: 'Update-E2E-${version}-portable.${ext}' };
  for (const key of ['guid', 'uninstallDisplayName', 'menuCategory']) delete nsis[key];
  nsis.shortcutName = IDENTITY.product;
  delete nsis.artifactName;
  build.nsis = nsis;
  build.publish = { provider: 'generic', url: feedUrl };
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  return pkg;
}

/** Replaces the real app's identity strings in the copy's text files; returns the files changed. */
function replaceRealTokens(appDir, files) {
  const changed = [];
  for (const rel of files) {
    if (rel === 'pnpm-lock.yaml' || !TEXT_EXTENSIONS.has(path.extname(rel).toLowerCase())) continue;
    const file = path.join(appDir, ...rel.split('/'));
    const before = fs.readFileSync(file, 'utf8');
    let after = before;
    for (const [from, to] of REAL_TOKENS) after = after.split(from).join(to);
    if (after !== before) {
      fs.writeFileSync(file, after);
      changed.push(rel);
    }
  }
  return changed;
}

/** Files under `dir` (skipping node_modules) whose text still holds a real-identity string. */
function findRealTokens(dir, { skip = ['node_modules', 'release', '.git'] } = {}) {
  const hits = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip.includes(entry.name)) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) && entry.name !== 'pnpm-lock.yaml') {
        const text = fs.readFileSync(full, 'utf8');
        for (const [from] of REAL_TOKENS) if (text.includes(from)) hits.push(`${path.relative(dir, full)}: ${from}`);
      }
    }
  };
  walk(dir);
  return hits;
}

async function trackedFiles(root) {
  const listed = await runProcess('git', ['ls-files', '-z'], { cwd: root });
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${firstLine(listed.stderr) || `exit ${listed.status}`}`);
  const files = [];
  for (const file of listed.stdout.split('\0').filter(Boolean)) if (pathExists(path.join(root, ...file.split('/')))) files.push(file);
  return files;
}

// ---------------------------------------------------------------------------------------------------------------
// latest.yml and app-update.yml (flat YAML, only the keys used here)

function yamlValue(text, key) {
  const m = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm').exec(text);
  return m ? m[1].replace(/^['"]|['"]$/g, '') : undefined;
}

/** latest.yml: version, files[0].url/sha512/size. */
function parseLatestYml(text) {
  const files = /^files:\s*\r?\n\s*-\s*url:\s*(\S+)\s*\r?\n\s*sha512:\s*(\S+)\s*\r?\n\s*size:\s*(\d+)/m.exec(text);
  if (!files) throw new Error('latest.yml has no files[0] with url, sha512 and size');
  return { version: yamlValue(text, 'version'), url: files[1], sha512: files[2], size: Number(files[3]), path: yamlValue(text, 'path') };
}

function verifyLatestYml(info, { version, installerName, installerPath }) {
  const problems = [];
  if (info.version !== version) problems.push(`version ${info.version}`);
  if (info.url !== installerName) problems.push(`files[0].url ${info.url}`);
  if (info.path !== installerName) problems.push(`path ${info.path}`);
  const bytes = fs.readFileSync(installerPath);
  if (info.size !== bytes.length) problems.push(`size ${info.size} != ${bytes.length}`);
  if (info.sha512 !== crypto.createHash('sha512').update(bytes).digest('base64')) problems.push('sha512 mismatch');
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// The feed

function requestPath(url) {
  const text = typeof url === 'string' ? url : '';
  const end = text.search(/[?#]/);
  return end === -1 ? text : text.slice(0, end);
}

/** GET and HEAD for latest.yml, the installer and its blockmap, from `dir`; 404 for anything else. */
function startFeedServer({ dir, installerName, port = 0, host = FEED_HOST, onRequest = () => {}, onError = () => {} }) {
  if (!/^[0-9A-Za-z._-]+$/.test(installerName)) throw new Error(`not a plain file name: ${installerName}`);
  const routes = new Map([
    ['/latest.yml', 'latest.yml'],
    [`/${installerName}`, installerName],
    [`/${installerName}.blockmap`, `${installerName}.blockmap`],
  ]);
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const entry = { at: Date.now(), method: req.method, url: req.url, status: 0, bytes: 0, complete: false };
    requests.push(entry);
    res.on('finish', () => {
      entry.complete = true;
    });
    res.on('close', () => onRequest(entry));
    const name = req.method === 'GET' || req.method === 'HEAD' ? routes.get(requestPath(req.url)) : undefined;
    const notFound = () => {
      const body = 'not found\n';
      entry.status = 404;
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
      if (req.method === 'HEAD') res.end();
      else {
        entry.bytes = Buffer.byteLength(body);
        res.end(body);
      }
    };
    if (name === undefined) return notFound();
    const file = path.join(dir, name);
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) return notFound();
      entry.status = 200;
      res.writeHead(200, { 'Content-Type': name.endsWith('.yml') ? 'text/yaml; charset=utf-8' : 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-store' });
      if (req.method === 'HEAD') return res.end();
      const stream = fs.createReadStream(file);
      stream.on('data', (chunk) => {
        entry.bytes += chunk.length;
      });
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    });
  });
  server.keepAliveTimeout = 0;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port, host }, () => {
      server.removeListener('error', reject);
      server.on('error', (err) => onError(err));
      const address = server.address();
      let closing = null;
      resolve({
        host: address.address,
        family: address.family,
        port: address.port,
        requests,
        openSockets: () => sockets.size,
        close() {
          if (closing) return closing;
          const closed = [];
          for (const socket of sockets) {
            closed.push(new Promise((done) => socket.once('close', done)));
            socket.on('error', () => {});
            if (socket.destroyed) continue;
            if (!socket.writableEnded && typeof socket.resetAndDestroy === 'function') socket.resetAndDestroy();
            else socket.destroy();
          }
          closed.push(new Promise((done) => server.close(() => done())));
          closing = Promise.all(closed).then(() => undefined);
          return closing;
        },
      });
    });
  });
}

function formatRequest(entry, t0) {
  const at = typeof t0 === 'number' ? `+${((entry.at - t0) / 1000).toFixed(1)} s ` : '';
  return `${at}${entry.method} ${entry.url} -> ${entry.status === 0 ? '(no response)' : entry.status}, ${entry.bytes} bytes${entry.complete ? '' : ' (not complete)'}`;
}

function pickFreePort(host = FEED_HOST) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen({ port: 0, host }, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// updater.log

function readAppended(file, offset) {
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
  return bytes.subarray(bytes.length < offset ? 0 : offset).toString('utf8');
}

const LOG_LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) (INFO|WARN|ERROR) (.*)$/;

function parseLogLines(text) {
  const parts = String(text).split('\n');
  parts.pop();
  return parts.map((raw) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const m = LOG_LINE.exec(line);
    return m ? { line, time: m[1], level: m[2], message: m[3], key: `${m[2]} ${m[3]}` } : { line, time: null, level: null, message: null, key: null };
  });
}

function matchInOrder(lines, expected) {
  const matched = [];
  let next = 0;
  for (const entry of lines) {
    if (next >= expected.length) break;
    if (entry.key === expected[next]) {
      matched.push(entry);
      next += 1;
    }
  }
  return { matched, missing: next < expected.length ? expected[next] : null };
}

/** The one ERROR line a successful run writes: only the new version's files are on the feed, so the differential
 * download finds no old blockmap and falls back to the full installer. */
const EXPECTED_ERROR_PREFIX = 'Cannot download differentially, fallback to full download: ';

function forbiddenLines(lines) {
  return lines.filter(({ level, message }) => {
    if (message === null) return true;
    if (level === 'ERROR') return !message.startsWith(EXPECTED_ERROR_PREFIX);
    return (
      message.startsWith('message box failed: ') ||
      message.startsWith('restart required to install ') ||
      message === 'install postponed: unsaved work' ||
      message === 'disabled-dev' ||
      message === 'disabled-no-config' ||
      message === 'disabled-portable' ||
      message === 'disabled-store'
    );
  });
}

function isProductDisplayName(displayName, product) {
  if (typeof displayName !== 'string' || !nonEmpty(product)) return false;
  if (displayName === product) return true;
  return displayName.startsWith(`${product} `) && /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(displayName.slice(product.length + 1));
}

// ---------------------------------------------------------------------------------------------------------------
// Child processes and PowerShell probes

function runProcess(command, args, { cwd, env, stdio = 'pipe', shell = false, timeoutMs = 0, ...rest } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { cwd, env, stdio, shell, windowsHide: true, ...rest });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (c) => {
        stdout += c;
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (c) => {
        stderr += c;
      });
    }
    let timer = null;
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (child.stdout) child.stdout.destroy();
        if (child.stderr) child.stderr.destroy();
        child.unref();
        settle({ status: null, signal: null, stdout, stderr, timedOut: true, pid: child.pid });
      }, timeoutMs);
    }
    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.once('close', (status, signal) => settle({ status, signal, stdout, stderr, timedOut: false, pid: child.pid }));
  });
}

/** This process's environment minus what npm/pnpm set for running this script and ELECTRON_RUN_AS_NODE. */
function childEnv(env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    const lower = key.toLowerCase();
    if (lower.startsWith('npm_') || lower === 'init_cwd' || lower === 'pnpm_script_src_dir' || lower === 'electron_run_as_node') continue;
    out[key] = value;
  }
  return out;
}

/** NSIS takes `/D=` and `_?=` only as the last argument, whole and unquoted: the command line goes verbatim. */
function nsisSpawn(exe, args) {
  if (exe.includes('"')) throw new Error(`the path ${exe} holds a double quote`);
  for (const arg of args) if (/["\r\n]/.test(arg)) throw new Error(`an NSIS argument holds a quote or a line break: ${JSON.stringify(arg)}`);
  return { file: exe, args: [...args], options: { windowsVerbatimArguments: true, argv0: `"${exe}"` } };
}

const psQuote = (value) => `'${String(value).replace(/['‘’‚‛]/g, (q) => q + q)}'`;

/** Every probe script starts with this. Assert-OnlyNotFound fails the probe on any error but "no such object". */
const PS_PRELUDE = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  'try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }',
  'function Assert-OnlyNotFound($errors, [string] $what) {',
  '  foreach ($e in @($errors)) {',
  '    if ($null -eq $e) { continue }',
  '    $category = [string] $e.CategoryInfo.Category',
  '    if ($category -ne \'ObjectNotFound\') { throw "$what failed: $($e.Exception.Message) ($category)" }',
  '  }',
  '}',
  'function Test-ItemExists([string] $path) {',
  '  try { $null = Get-Item -LiteralPath $path -Force -ErrorAction Stop; return $true }',
  '  catch [System.Management.Automation.ItemNotFoundException] { return $false }',
  '}',
].join('\n');

async function powershellJson(script, { timeoutMs = 120000 } = {}) {
  const body = `${PS_PRELUDE}\ntry {\n${script}\n} catch {\n  [Console]::Error.WriteLine([string] $_.Exception.Message)\n  exit 1\n}`;
  const encoded = Buffer.from(body, 'utf16le').toString('base64');
  const result = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { timeoutMs });
  if (result.timedOut) throw new Error(`a PowerShell probe did not finish within ${seconds(timeoutMs)}`);
  if (result.status !== 0) throw new Error(`a PowerShell probe exited ${result.status}: ${firstLine(result.stderr) || firstLine(result.stdout)}`);
  const text = result.stdout.trim();
  if (text === '') throw new Error('a PowerShell probe printed nothing');
  return JSON.parse(text);
}

/** Every process (pid, ppid, path), and for those whose executable is under `dir` also its command line. */
async function probeProcesses(dir) {
  const all = await powershellJson(`
$prefix = ${psQuote(withSep(path.resolve(dir)))}
$items = @(foreach ($p in Get-CimInstance -ClassName Win32_Process) {
  $exe = $p.ExecutablePath
  $under = [bool]($exe -and $exe.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase))
  $command = $null
  if ($under) { $command = $p.CommandLine }
  [pscustomobject]@{ pid = [int]$p.ProcessId; ppid = [int]$p.ParentProcessId; path = $exe; under = $under; commandLine = $command }
})
ConvertTo-Json -InputObject $items -Compress -Depth 2`);
  return { all, under: all.filter((p) => p.under) };
}

async function waitPidsGone(pids, timeoutMs) {
  const ids = pids.map((pid) => String(Math.trunc(Number(pid)))).join(', ');
  return powershellJson(
    `
$ids = @(${ids})
$start = Get-Date
$deadline = $start.AddMilliseconds(${Math.trunc(timeoutMs)})
while ($true) {
  $alive = @()
  foreach ($id in $ids) {
    $e = $null
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue -ErrorVariable e
    Assert-OnlyNotFound $e "Get-Process -Id $id"
    if ($null -ne $p) { $alive += $id }
  }
  if ($alive.Count -eq 0 -or (Get-Date) -ge $deadline) { break }
  Start-Sleep -Milliseconds 200
}
ConvertTo-Json -InputObject ([pscustomobject]@{ alive = @($alive); ms = [int]((Get-Date) - $start).TotalMilliseconds }) -Compress`,
    { timeoutMs: timeoutMs + 60000 },
  );
}

async function probeUninstallEntries(product) {
  const entries = await powershellJson(`
$root = ${psQuote(UNINSTALL_ROOT)}
$prefix = ${psQuote(product)}
$e = $null
$keys = @(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue -ErrorVariable e)
Assert-OnlyNotFound $e 'listing the HKCU Uninstall keys'
$items = @(foreach ($key in $keys) {
  $e = $null
  $p = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue -ErrorVariable e
  Assert-OnlyNotFound $e "reading $($key.PSChildName)"
  if ($null -ne $p -and $p.DisplayName -is [string] -and $p.DisplayName.StartsWith($prefix, [System.StringComparison]::Ordinal)) {
    [pscustomobject]@{ key = $key.PSChildName; displayName = $p.DisplayName; displayVersion = $p.DisplayVersion; uninstallString = $p.UninstallString }
  }
})
ConvertTo-Json -InputObject $items -Compress -Depth 2`);
  return entries.filter((entry) => isProductDisplayName(entry.displayName, product));
}

const GUID = /^\{?[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}?$/;

async function probeInstallKey(guid) {
  if (!GUID.test(String(guid))) throw new Error(`not a GUID: ${guid}`);
  return powershellJson(`
$key = 'HKCU:\\Software\\' + ${psQuote(guid)}
$out = [pscustomobject]@{ key = $key; exists = (Test-ItemExists $key); installLocation = $null }
if ($out.exists) { $out.installLocation = (Get-ItemProperty -LiteralPath $key).InstallLocation }
ConvertTo-Json -InputObject $out -Compress`);
}

async function probeKeysExist(keys) {
  const list = keys.map((key) => psQuote(key)).join(', ');
  return powershellJson(`
$items = @(foreach ($k in @(${list})) { [pscustomobject]@{ key = $k; exists = (Test-ItemExists $k) } })
ConvertTo-Json -InputObject $items -Compress -Depth 2`);
}

async function probeShortcuts(fileName) {
  return powershellJson(`
$name = ${psQuote(fileName)}
$shell = New-Object -ComObject WScript.Shell
$folders = @(@{ where = 'Desktop'; path = [Environment]::GetFolderPath('DesktopDirectory') }, @{ where = 'Start menu Programs'; path = [Environment]::GetFolderPath('Programs') })
$items = @(foreach ($folder in $folders) {
  $file = $null
  $exists = $false
  $target = $null
  if ($folder.path) {
    $file = Join-Path $folder.path $name
    $exists = Test-ItemExists $file
    if ($exists) { $target = $shell.CreateShortcut($file).TargetPath }
  }
  [pscustomobject]@{ where = $folder.where; folder = $folder.path; file = $file; exists = $exists; target = $target }
})
ConvertTo-Json -InputObject $items -Compress -Depth 2`);
}

async function probeTcp(port) {
  return powershellJson(`
$e = $null
$items = @(Get-NetTCPConnection -LocalPort ${Math.trunc(Number(port))} -ErrorAction SilentlyContinue -ErrorVariable e | ForEach-Object {
  [pscustomobject]@{ localAddress = $_.LocalAddress; localPort = [int]$_.LocalPort; remoteAddress = $_.RemoteAddress; remotePort = [int]$_.RemotePort; state = [string]$_.State; owningProcess = [int]$_.OwningProcess }
})
Assert-OnlyNotFound $e 'Get-NetTCPConnection'
ConvertTo-Json -InputObject $items -Compress -Depth 2`);
}

async function probeWindows(pid) {
  return powershellJson(`
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
$ofProcess = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, ${Math.trunc(Number(pid))})
$isWindow = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
$ownedCondition = [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.Condition[]] @($ofProcess, $isWindow))
$items = @(foreach ($top in $AE::RootElement.FindAll($scope::Children, $ofProcess)) {
  $owned = @(foreach ($w in $top.FindAll($scope::Children, $ownedCondition)) { [pscustomobject]@{ name = $w.Current.Name; className = $w.Current.ClassName } })
  [pscustomobject]@{ name = $top.Current.Name; className = $top.Current.ClassName; controlType = $top.Current.ControlType.ProgrammaticName; owned = $owned }
})
ConvertTo-Json -InputObject $items -Compress -Depth 4`);
}

async function probeFileVersion(file) {
  return powershellJson(`
$v = (Get-Item -LiteralPath ${psQuote(file)}).VersionInfo
ConvertTo-Json -InputObject ([pscustomobject]@{ fileVersion = $v.FileVersion; productVersion = $v.ProductVersion }) -Compress`);
}

async function removeRegistryKey(key) {
  return powershellJson(`
Remove-Item -LiteralPath ${psQuote(key)} -Recurse
ConvertTo-Json -InputObject ([pscustomobject]@{ removed = (-not (Test-ItemExists ${psQuote(key)})) }) -Compress`);
}

async function probeKnownFolders() {
  return powershellJson(`
ConvertTo-Json -InputObject ([pscustomobject]@{ appData = [Environment]::GetFolderPath('ApplicationData'); localAppData = [Environment]::GetFolderPath('LocalApplicationData') }) -Compress`);
}

const P = Object.freeze({
  processes: probeProcesses,
  pidsGone: waitPidsGone,
  uninstallEntries: probeUninstallEntries,
  installKey: probeInstallKey,
  keysExist: probeKeysExist,
  shortcuts: probeShortcuts,
  tcp: probeTcp,
  windows: probeWindows,
  fileVersion: probeFileVersion,
  removeRegistryKey,
  knownFolders: probeKnownFolders,
});

/** PIDs to stop for the processes under the work folder: each by its own PID, roots first, never `taskkill /T`. */
function planKills({ all, under }) {
  const underPids = new Set(under.map((p) => p.pid));
  const children = new Map();
  for (const p of all) {
    if (p.ppid === p.pid) continue;
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p);
  }
  const kills = [];
  const visited = new Set();
  const queue = under.filter((p) => !underPids.has(p.ppid)).map((p) => p.pid);
  while (queue.length > 0) {
    const pid = queue.shift();
    if (visited.has(pid)) continue;
    visited.add(pid);
    if (underPids.has(pid)) kills.push(pid);
    for (const child of children.get(pid) || []) if (!visited.has(child.pid)) queue.push(child.pid);
  }
  for (const p of under) if (!visited.has(p.pid)) kills.push(p.pid);
  return kills;
}

/** `rootPid` and every descendant of it in the process list `all` (by ppid). */
function descendantsOf(all, rootPid) {
  const out = [];
  const seen = new Set([rootPid]);
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift();
    const self = all.find((p) => p.pid === pid);
    if (self) out.push(self);
    for (const p of all) if (p.ppid === pid && !seen.has(p.pid)) { seen.add(p.pid); queue.push(p.pid); }
  }
  return out;
}

const findAnswer = (lines) => {
  const line = lines.find((l) => l.key === 'INFO prompt answer now' || l.key === 'INFO prompt answer later');
  return line ? line.message.slice('prompt answer '.length) : null;
};

function findPrompt(windows) {
  for (const top of windows) {
    if (top.name === PROMPT_TITLE) return { where: 'top-level', className: top.className };
    for (const owned of top.owned || []) if (owned.name === PROMPT_TITLE) return { where: `owned by "${top.name}"`, className: owned.className };
  }
  return null;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** The work folder: `requested`, created when missing; refused inside the repository or under the Windows folder
 * (the builds and the installed app do not work there), and (stage all/build) when not empty unless it holds
 * state.json from an earlier --stage build. */
function prepareWorkDir(requested, { resume }) {
  let dir;
  let created = false;
  if (!requested) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-e2e-'));
    created = true;
  } else {
    dir = path.resolve(requested);
    if (fs.existsSync(dir)) {
      if (!fs.statSync(dir).isDirectory()) throw new Refusal(`--work ${dir} is not a directory`);
      const resumable = fs.existsSync(path.join(dir, 'state.json'));
      if (fs.readdirSync(dir).length > 0 && !(resume && resumable)) throw new Refusal(`--work ${dir} is not empty (or has no state.json to resume); name a new or empty folder`);
    } else {
      if (resume === 'test') throw new Refusal(`--work ${dir} does not exist, so there is no build to test`);
      fs.mkdirSync(dir, { recursive: true });
      created = true;
    }
  }
  dir = fs.realpathSync.native(dir);
  const realRoot = realpathOrResolved(ROOT);
  const sysRoot = nonEmpty(process.env.SystemRoot) ? realpathOrResolved(process.env.SystemRoot) : null;
  const refuse = (m) => {
    if (created) fs.rmSync(dir, { recursive: true, force: true });
    throw new Refusal(m);
  };
  if (isInsideOrEqual(realRoot, dir) || isInsideOrEqual(dir, realRoot)) refuse(`the work folder ${dir} overlaps the repository ${realRoot}`);
  if (sysRoot !== null && isInsideOrEqual(sysRoot, dir)) refuse(`the work folder ${dir} is under the Windows folder (${sysRoot}), where the builds and the installed app do not work; pass --work <a short folder elsewhere>`);
  return dir;
}

// ---------------------------------------------------------------------------------------------------------------
// The run

class Harness {
  constructor(options, log = (line) => console.log(line)) {
    this.options = options;
    this.print = log;
    this.answer = options.answer === 'manual' ? null : options.answer;
    this.clickedBy = null;
    this.work = null;
    this.workIsOurs = false;
    this.dirs = null;
    this.pkg = null;
    this.names = null;
    this.appData = null;
    this.localAppData = null;
    this.guid = null;
    this.userDataDir = null;
    this.homeLogDir = path.join(os.homedir(), IDENTITY.product);
    this.logFile = null;
    this.cacheDir = null;
    this.cacheMarker = null;
    this.beforeUninstall = null;
    this.port = null;
    this.feedUrl = null;
    this.feed = null;
    this.feedStartedAt = null;
    this.exe = null;
    this.logProduct = null;
    this.touchedProfile = false;
    this.uninstallKey = null;
    this.displayNames = new Set();
    this.appPid = null;
    this.relaunchedCommandLine = null;
    this.runLogOffset = 0;
    this.logText = null;
    this.portableLines = null;
    this.portableKnown = [];
    this.matched = [];
    this.checks = [];
    this.marks = [{ name: 'start', at: Date.now() }];
    this.seen = {};
    this.error = null;
    this.refused = null;
    this.aborted = null;
    this.wakers = new Set();
  }

  log(line) {
    this.print(`update-e2e: ${line}`);
  }

  mark(name) {
    this.marks.push({ name, at: Date.now() });
    this.log(`-- ${name}`);
  }

  check(passed, what, detail) {
    const entry = { passed: Boolean(passed), what, detail: detail === undefined || detail === null ? '' : String(detail) };
    this.checks.push(entry);
    this.log(`${entry.passed ? 'PASS' : 'FAIL'} ${what}${entry.detail ? ` (${entry.detail})` : ''}`);
    return entry.passed;
  }

  require(passed, what, detail) {
    if (!this.check(passed, what, detail)) throw new CheckFailed(what);
  }

  passed() {
    return this.error === null && this.refused === null && this.aborted === null && this.checks.length > 0 && this.checks.every((c) => c.passed);
  }

  abort(signal) {
    if (this.aborted) return;
    this.aborted = signal;
    for (const wake of this.wakers) wake();
    this.wakers.clear();
    if (this.feed) void this.feed.close();
  }

  crash(err, origin) {
    if (this.error === null) this.error = err instanceof Error ? err : new Error(String(err));
    this.log(`${origin}: ${firstLine(err)}`);
    this.abort(origin);
  }

  sleep(ms) {
    if (this.aborted) return Promise.reject(new Aborted(this.aborted));
    return new Promise((resolve, reject) => {
      const wake = () => {
        clearTimeout(timer);
        reject(new Aborted(this.aborted));
      };
      const timer = setTimeout(() => {
        this.wakers.delete(wake);
        resolve();
      }, ms);
      this.wakers.add(wake);
    });
  }

  installerName(version) {
    return `Update-E2E-Setup-${version}.exe`;
  }

  portableName(version) {
    return `Update-E2E-${version}-portable.exe`;
  }

  get stageBuild() {
    return this.options.stage === 'all' || this.options.stage === 'build';
  }

  get stageTest() {
    return !this.options.preflight && (this.options.stage === 'all' || this.options.stage === 'test');
  }

  async run() {
    try {
      await this.prepare();
      if (!this.options.preflight) {
        if (this.stageBuild) await this.build();
        if (this.stageTest) {
          await this.serve();
          await this.portablePhase();
          await this.installOld();
          await this.launchAndWaitForDownload();
          await this.answerPrompt();
          if (this.answer === 'now') await this.followNow();
          else await this.followLater();
          this.noteUpdateCache();
          this.checkWholeLog();
          this.checkFeedRequests();
        }
      }
    } catch (err) {
      if (err instanceof Refusal) {
        this.refused = err.message;
        this.log(`REFUSED ${err.message}`);
      } else if (err instanceof Aborted) {
        this.log(`stopped by ${this.aborted}`);
      } else if (!(err instanceof CheckFailed)) {
        if (this.error === null) this.error = err;
        this.log(`ERROR ${err && err.stack ? err.stack : err}`);
      }
    } finally {
      if (this.logFile && this.touchedProfile) {
        try {
          this.logText = readAppended(this.logFile, this.portableLogStart ?? this.runLogOffset);
        } catch (err) {
          this.log(`could not read ${this.logFile}: ${firstLine(err)}`);
        }
      }
      await this.teardown();
    }
    this.printSummary();
    if (this.refused !== null && !this.touchedProfile) return 2;
    return this.passed() ? 0 : 1;
  }

  // -- the copy, its identity, the pre-flight and the two builds ---------------------------------------------

  async prepare() {
    if (process.platform !== 'win32') throw new Refusal('update-e2e runs on Windows only (NSIS, the HKCU registry, UI Automation)');
    const known = await P.knownFolders();
    for (const [name, value] of [['APPDATA', known.appData], ['LOCALAPPDATA', known.localAppData]]) {
      if (!samePath(process.env[name], value)) throw new Refusal(`${name} is ${process.env[name]}, the known folder is ${value}`);
    }
    this.appData = known.appData;
    this.localAppData = known.localAppData;
    this.work = prepareWorkDir(this.options.work, { resume: this.options.stage === 'all' ? false : this.options.stage });
    this.workIsOurs = true;
    this.dirs = {
      app: path.join(this.work, 'app'),
      A: path.join(this.work, 'A'),
      B: path.join(this.work, 'B'),
      install: path.join(this.work, 'install'),
      uninstaller: path.join(this.work, 'uninstaller'),
      logs: path.join(this.work, 'logs'),
    };
    this.statePath = path.join(this.work, 'state.json');
    this.log(`work folder ${this.work}`);

    const haveCopy = pathExists(path.join(this.dirs.app, 'package.json'));
    if (this.options.stage === 'test' && !haveCopy) throw new Refusal(`--stage test needs the builds of an earlier --stage build in ${this.work}`);
    if (!haveCopy) {
      this.port = await pickFreePort(FEED_HOST);
      this.feedUrl = `http://${FEED_HOST}:${this.port}/`;
      fs.writeFileSync(this.statePath, JSON.stringify({ port: this.port }));
      const files = await trackedFiles(ROOT);
      for (const file of files) {
        const to = path.join(this.dirs.app, ...file.split('/'));
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(path.join(ROOT, ...file.split('/')), to);
      }
      this.require(files.length > 0, `copied the tracked files into ${this.dirs.app}`, `${files.length} files`);
      const changed = replaceRealTokens(this.dirs.app, files);
      this.log(`replaced the real identity strings in ${changed.length} text files`);
      this.pkg = applyPackageJson(this.dirs.app, { version: OLD_VERSION, feedUrl: this.feedUrl });
      this.mark('copied the repository and gave it the test identity');
    } else {
      const state = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      this.port = state.port;
      this.feedUrl = `http://${FEED_HOST}:${this.port}/`;
      this.pkg = JSON.parse(fs.readFileSync(path.join(this.dirs.app, 'package.json'), 'utf8'));
      this.log(`resuming the copy in ${this.dirs.app} (feed ${this.feedUrl})`);
    }
    const hits = findRealTokens(this.dirs.app);
    this.require(hits.length === 0, "the copy holds no 'photo_app', 'com.photoeditorpro.app' or 'Photo Editor Pro' (text files outside node_modules)", hits.slice(0, 5).join('; '));
    this.readIdentity();
    await this.preflightProfile();
    this.mark('pre-flight: nothing of the test identity on this profile');
  }

  readIdentity() {
    const pkg = this.pkg;
    this.require(pkg.name === IDENTITY.name && pkg.productName === IDENTITY.product && pkg.build.appId === IDENTITY.appId, `package.json identity is ${IDENTITY.name} / ${IDENTITY.product} / ${IDENTITY.appId}`);
    const main = fs.readFileSync(path.join(this.dirs.app, 'electron', 'main.cjs'), 'utf8');
    this.require(main.includes(`app.setName('${IDENTITY.name}')`), `electron/main.cjs pins userData with app.setName('${IDENTITY.name}')`);
    this.require(main.includes(`path.join(os.homedir(), '${IDENTITY.product}', 'logs')`), `electron/main.cjs logs to ~\\${IDENTITY.product}\\logs`);
    const logProduct = /productName:\s*'([^']+)'/.exec(main.slice(main.indexOf('createUpdater(')));
    this.require(Boolean(logProduct), 'electron/main.cjs passes a productName to createUpdater');
    this.logProduct = logProduct[1];
    const base = productFilename(pkg);
    this.names = {
      product: pkg.productName,
      exe: `${base}.exe`,
      uninstaller: `Uninstall ${base}.exe`,
      shortcut: `${pkg.build.nsis.shortcutName}.lnk`,
    };
    this.guid = nsisGuid(pkg.build.appId);
    this.userDataDir = path.join(this.appData, IDENTITY.name);
    this.logFile = path.join(this.userDataDir, 'logs', 'updater.log');
    this.cacheDir = path.join(this.localAppData, updaterCacheDirName(pkg.name));
  }

  async preflightProfile() {
    const found = [];
    for (const entry of await P.uninstallEntries(this.names.product)) found.push(`the HKCU uninstall entry "${entry.displayName}" (${entry.key})`);
    for (const key of await P.keysExist([`${UNINSTALL_ROOT}\\${this.guid}`])) if (key.exists) found.push(key.key);
    const installKey = await P.installKey(this.guid);
    if (installKey.exists) found.push(`${installKey.key} (InstallLocation ${installKey.installLocation})`);
    for (const dir of [this.userDataDir, this.cacheDir, this.homeLogDir]) if (pathExists(dir)) found.push(dir);
    for (const s of await P.shortcuts(this.names.shortcut)) {
      if (!nonEmpty(s.folder)) throw new Error(`the ${s.where} folder could not be resolved`);
      if (s.exists) found.push(s.file);
    }
    if (found.length > 0) throw new Refusal(`nothing was installed, because these already exist and are not this run's to remove (docs/UPDATES.md, "If a run was interrupted"): ${found.join('; ')}`);
    this.log(`no ${this.names.product} entry, key, shortcut, ${this.userDataDir}, ${this.cacheDir} or ${this.homeLogDir} on this profile`);
  }

  /** Runs a build command in the copy; its output goes to <work>\logs\<name>.log, the tail is printed. */
  async step(name, command) {
    fs.mkdirSync(this.dirs.logs, { recursive: true });
    this.log(`running: ${command} (cwd ${this.dirs.app})`);
    const result = await runProcess(command, [], { cwd: this.dirs.app, env: childEnv(process.env), shell: true, timeoutMs: BUILD_STEP_MS });
    const out = `${result.stdout}\n${result.stderr}`;
    fs.writeFileSync(path.join(this.dirs.logs, `${name}.log`), out);
    const tail = out.trim().split(/\r?\n/).slice(-8);
    for (const line of tail) this.log(`  | ${line}`);
    this.require(!result.timedOut && result.status === 0, `${command} exited 0`, result.timedOut ? `still running after ${seconds(BUILD_STEP_MS)}; rerun --stage build to resume` : result.status === 0 ? `log ${name}.log` : `exit ${result.status}`);
  }

  async build() {
    await this.step('install', 'pnpm install --frozen-lockfile --prefer-offline');
    this.mark('pnpm install');
    await this.buildRelease(OLD_VERSION, this.dirs.A, '--win --x64');
    await this.buildRelease(NEW_VERSION, this.dirs.B, '--win nsis --x64');

    const installer = this.installerName(NEW_VERSION);
    const info = parseLatestYml(fs.readFileSync(path.join(this.dirs.B, 'latest.yml'), 'utf8'));
    const problems = verifyLatestYml(info, { version: NEW_VERSION, installerName: installer, installerPath: path.join(this.dirs.B, installer) });
    this.require(problems.length === 0, `B\\latest.yml names ${installer} and its size and sha512 match the file`, problems.join('; ') || `files[0].url ${info.url}`);
    this.require(pathExists(path.join(this.dirs.B, `${installer}.blockmap`)), `B holds ${installer}.blockmap`);
    this.require(pathExists(path.join(this.dirs.A, this.portableName(OLD_VERSION))), `A holds ${this.portableName(OLD_VERSION)}`);
    const config = fs.readFileSync(path.join(this.dirs.B, 'win-unpacked', 'resources', 'app-update.yml'), 'utf8');
    this.require(yamlValue(config, 'provider') === 'generic' && yamlValue(config, 'url') === this.feedUrl, `the ${NEW_VERSION} build's app-update.yml reads the feed ${this.feedUrl}`, config.replace(/\r?\n/g, ' | '));
    this.require(yamlValue(config, 'updaterCacheDirName') === path.basename(this.cacheDir), `app-update.yml names the updater cache the pre-flight checked (${path.basename(this.cacheDir)})`);
    // The built bundle must not carry the real identity either.
    const dist = findRealTokens(path.join(this.dirs.app, 'dist'));
    this.require(dist.length === 0, 'dist/ holds none of the real identity strings', dist.slice(0, 5).join('; '));
  }

  async buildRelease(version, dest, builderArgs) {
    if (pathExists(path.join(dest, 'latest.yml'))) {
      this.log(`${dest} already holds a ${version} build: skipped`);
      return;
    }
    const file = path.join(this.dirs.app, 'package.json');
    this.pkg = applyPackageJson(this.dirs.app, { version, feedUrl: this.feedUrl });
    this.log(`package.json: version ${version}, build.publish { provider: generic, url: ${this.feedUrl} }`);
    await removeDir(path.join(this.dirs.app, 'release'));
    await this.step(`build-${version}`, 'pnpm build');
    await this.step(`electron-builder-${version}`, `node scripts/build-installer.cjs ${builderArgs} --publish=never`);
    const release = path.join(this.dirs.app, 'release');
    this.require(pathExists(path.join(release, this.installerName(version))), `electron-builder wrote ${this.installerName(version)}`);
    fs.cpSync(release, dest, { recursive: true });
    this.mark(`built ${version}, copied to ${dest}`);
    void file;
  }

  // -- the feed, the portable exe and the 0.1.0 install --------------------------------------------------------

  async serve() {
    this.feedStartedAt = Date.now();
    this.feed = await startFeedServer({
      dir: this.dirs.B,
      installerName: this.installerName(NEW_VERSION),
      port: this.port,
      onRequest: (entry) => this.log(`feed: ${formatRequest(entry, this.feedStartedAt)}`),
      onError: (err) => this.crash(err, 'feed server error'),
    });
    this.require(this.feed.host === FEED_HOST && this.feed.family === 'IPv4', `the feed is bound to ${FEED_HOST} only`, `${this.feed.host}:${this.feed.port}`);
    const tcp = await P.tcp(this.port);
    const listening = tcp.filter((c) => c.state === 'Listen');
    this.seen.listening = listening.length;
    this.require(listening.length === 1 && listening[0].localAddress === FEED_HOST && listening[0].owningProcess === process.pid, `Get-NetTCPConnection -LocalPort ${this.port} sees this process listening on ${FEED_HOST}`, JSON.stringify(tcp));
    this.mark(`feed up on ${this.feedUrl}`);
  }

  /** The portable exe never self-updates: it logs `disabled-portable`, checks nothing, and the feed sees no request. */
  async portablePhase() {
    const exe = path.join(this.dirs.A, this.portableName(OLD_VERSION));
    this.portableLogStart = fileSize(this.logFile);
    const from = this.portableLogStart;
    this.touchedProfile = true;
    const child = spawn(exe, [], { cwd: this.dirs.A, detached: true, stdio: 'ignore', env: childEnv(process.env) });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    const rootPid = child.pid;
    this.mark(`started the portable ${OLD_VERSION} (pid ${rootPid})`);
    try {
      const lines = await this.waitForLines({
        from,
        lines: [`INFO started ${this.logProduct} ${OLD_VERSION}`, 'INFO disabled-portable'],
        timeoutMs: PORTABLE_WAIT_MS,
        what: `the portable ${OLD_VERSION} logging disabled-portable`,
        pid: rootPid,
        allowDisabled: true,
      });
      this.portableLines = lines.map((l) => l.line);
      // Record who runs (for a clean stop), then give a check that did not happen time to show itself.
      const procs = await P.processes(this.work);
      this.portableKnown = descendantsOf(procs.all, rootPid).map((p) => ({ pid: p.pid, path: p.path }));
      this.seen.portableProcesses = this.portableKnown.length;
      this.seen.userData = pathExists(this.userDataDir);
      this.seen.homeLogs = pathExists(this.homeLogDir);
      await this.sleep(5000);
      const after = parseLogLines(readAppended(this.logFile, from));
      this.check(!after.some((l) => l.key === 'INFO checking'), 'the portable build logged no "checking" (no update check)', after.map((l) => l.message).join(' | '));
      this.check(this.feed.requests.length === 0, 'the feed saw no request while the portable build ran (no network)', `${this.feed.requests.length} requests`);
    } finally {
      await this.stopPortable(rootPid);
    }
    this.mark('stopped the portable build');
  }

  /** Stops the portable launcher and what it started, each by PID: the app's main process first, by a normal close. */
  async stopPortable(rootPid) {
    const procs = await P.processes(this.work);
    const tree = descendantsOf(procs.all, rootPid);
    const main = tree.find((p) => p.path && path.basename(p.path).toLowerCase() === this.names.exe.toLowerCase() && !/(^|\s)--type=/.test(p.commandLine || '') && !isInsideOrEqual(this.work, p.path));
    const dirsToRemove = new Set();
    for (const p of tree) if (p.path && !isInsideOrEqual(this.work, p.path) && isInsideOrEqual(os.tmpdir(), p.path) && path.basename(p.path).toLowerCase() === this.names.exe.toLowerCase()) dirsToRemove.add(path.dirname(p.path));
    if (main) {
      const close = await runProcess('taskkill', ['/pid', String(main.pid)], { timeoutMs: 30000 });
      this.log(`taskkill /pid ${main.pid} (no /F): exit ${close.status} ${firstLine(close.stdout) || firstLine(close.stderr)}`);
      await P.pidsGone([main.pid], 15000);
    }
    const left = descendantsOf((await P.processes(this.work)).all, rootPid).filter((p) => p.pid !== process.pid);
    for (const p of left) {
      const r = await runProcess('taskkill', ['/pid', String(p.pid), '/F'], { timeoutMs: 30000 });
      this.log(`taskkill /pid ${p.pid} /F (portable leftover): exit ${r.status}`);
    }
    const ids = [rootPid, ...tree.map((p) => p.pid)];
    const gone = await P.pidsGone([...new Set(ids)], KILL_WAIT_MS);
    this.check(gone.alive.length === 0, 'the portable build and the processes it started are gone (Get-Process -Id)', gone.alive.length ? `still there: ${gone.alive.join(', ')}` : `after ${gone.ms} ms`);
    for (const dir of dirsToRemove) {
      if (path.resolve(dir) !== path.resolve(os.tmpdir()) && pathExists(dir)) {
        await removeDir(dir);
        this.log(`removed the portable build's extracted folder ${dir}`);
      }
    }
  }

  async installOld() {
    const installer = path.join(this.dirs.A, this.installerName(OLD_VERSION));
    const spec = nsisSpawn(installer, ['/S', '/currentuser', `/D=${this.dirs.install}`]);
    this.log(`installing: "${installer}" ${spec.args.join(' ')}`);
    this.touchedProfile = true;
    const result = await runProcess(spec.file, spec.args, { ...spec.options, env: childEnv(process.env), timeoutMs: INSTALL_WAIT_MS });
    this.require(!result.timedOut && result.status === 0, `the ${OLD_VERSION} installer exited 0`, result.timedOut ? `still running after ${seconds(INSTALL_WAIT_MS)}` : result.status === 0 ? '' : `exit ${result.status}`);
    this.mark(`installed ${OLD_VERSION}`);

    this.exe = path.join(this.dirs.install, this.names.exe);
    this.require(pathExists(this.exe), `${this.names.exe} is in ${this.dirs.install}`);
    const exes = fs.readdirSync(this.dirs.install).filter((f) => /\.exe$/i.test(f));
    this.require(exes.includes(this.names.uninstaller), `the uninstaller is "${this.names.uninstaller}"`, `the install folder's .exe files: ${exes.join(', ')}`);

    const entries = await P.uninstallEntries(this.names.product);
    this.require(entries.length === 1, `one HKCU uninstall entry for ${this.names.product}`, JSON.stringify(entries));
    const entry = entries[0];
    this.uninstallKey = entry.key;
    this.displayNames.add(entry.displayName);
    this.require(entry.key === this.guid, `its key is the GUID NSIS derives from ${IDENTITY.appId} (${this.guid})`, entry.key);
    this.require(entry.displayVersion === OLD_VERSION, `its DisplayVersion is ${OLD_VERSION}`, `DisplayName "${entry.displayName}", DisplayVersion ${entry.displayVersion}`);
    this.seen.uninstallEntry = `"${entry.displayName}" ${entry.displayVersion}`;
    const installKey = await P.installKey(this.guid);
    this.seen.installKey = installKey.exists === true && samePath(installKey.installLocation, this.dirs.install);
    this.check(this.seen.installKey, `${installKey.key} holds InstallLocation ${this.dirs.install}`, JSON.stringify(installKey));
    const shortcuts = await P.shortcuts(this.names.shortcut);
    this.seen.shortcutFiles = shortcuts.filter((s) => s.exists).map((s) => s.file);
    for (const s of shortcuts) this.check(s.exists && samePath(s.target, this.exe), `the installer made ${s.file}, pointing at the installed exe`, `exists ${s.exists}, target ${s.target}`);
    const config = fs.readFileSync(path.join(this.dirs.install, 'resources', 'app-update.yml'), 'utf8');
    this.require(yamlValue(config, 'provider') === 'generic' && yamlValue(config, 'url') === this.feedUrl && yamlValue(config, 'updaterCacheDirName') === path.basename(this.cacheDir), 'the installed app-update.yml reads the local feed and names the test updater cache', config.replace(/\r?\n/g, ' | '));
  }

  // -- launch, download, prompt ---------------------------------------------------------------------------------

  async launch() {
    const child = spawn(this.exe, [], { cwd: this.dirs.install, detached: true, stdio: 'ignore', env: childEnv(process.env) });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    return child.pid;
  }

  async launchAndWaitForDownload() {
    this.runLogOffset = fileSize(this.logFile);
    this.appPid = await this.launch();
    this.mark(`started the installed ${OLD_VERSION} (pid ${this.appPid})`);
    const procs = await P.processes(this.work);
    this.seen.processes = procs.under.length;
    const main = procs.under.find((p) => p.pid === this.appPid);
    this.require(Boolean(main) && samePath(main.path, this.exe), `pid ${this.appPid} runs ${this.exe}`, main ? main.path : 'the process probe did not find it');
    await this.waitForLines({
      from: this.runLogOffset,
      lines: [`INFO started ${this.logProduct} ${OLD_VERSION}`, 'INFO checking', `INFO update available ${NEW_VERSION}`, `INFO update downloaded ${NEW_VERSION}`],
      timeoutMs: DOWNLOAD_WAIT_MS,
      what: `the installed ${OLD_VERSION} finding and downloading ${NEW_VERSION}`,
      pid: this.appPid,
    });
    this.mark(`update downloaded ${NEW_VERSION}`);
    this.seen.userData = pathExists(this.userDataDir);
    this.require(this.seen.userData, `the app keeps its data in ${this.userDataDir} (not in the real install's folder)`);
    this.seen.homeLogs = pathExists(this.homeLogDir);
    this.check(this.seen.homeLogs, `the app logs under ${this.homeLogDir}`);
    const pending = path.join(this.cacheDir, 'pending', this.installerName(NEW_VERSION));
    this.seen.cacheDir = pathExists(pending);
    this.require(this.seen.cacheDir, `electron-updater downloaded ${NEW_VERSION} to ${pending}`);
    const marker = path.join(this.cacheDir, CACHE_MARKER);
    fs.writeFileSync(marker, 'update-e2e wrote this before the update.\n', { flag: 'wx' });
    this.cacheMarker = marker;
  }

  failOnForbiddenLines(what, from) {
    const bad = forbiddenLines(parseLogLines(readAppended(this.logFile, from)));
    if (bad.length > 0) this.require(false, what, `updater.log: ${bad.map((l) => l.line).join(' | ')}`);
  }

  async waitForLines({ from, lines, timeoutMs, what, pid = null, allowDisabled = false }) {
    const started = Date.now();
    this.log(`waiting up to ${seconds(timeoutMs)} for ${what}: ${lines.map((l) => l.replace(/^INFO /, '')).join(' -> ')}`);
    for (;;) {
      if (!allowDisabled) this.failOnForbiddenLines(what, from);
      const parsed = parseLogLines(readAppended(this.logFile, from));
      const { missing } = matchInOrder(parsed, lines);
      if (missing === null) {
        this.check(true, what, `after ${seconds(Date.now() - started)}`);
        return parsed;
      }
      if (pid !== null && !isAlive(pid)) {
        const gone = await P.pidsGone([pid], 0);
        if (gone.alive.length === 0 && !allowDisabled) this.require(false, what, `pid ${pid} is gone and updater.log has no "${missing}"`);
      }
      if (Date.now() - started >= timeoutMs) this.require(false, what, `no "${missing}" within ${seconds(timeoutMs)}`);
      await this.sleep(POLL_MS);
    }
  }

  async expectPromptWindow(pid) {
    const started = Date.now();
    let last = null;
    for (;;) {
      try {
        last = await P.windows(pid);
      } catch (err) {
        last = { error: firstLine(err) };
      }
      const prompt = Array.isArray(last) ? findPrompt(last) : null;
      if (prompt) {
        this.check(true, `UI Automation sees the "${PROMPT_TITLE}" box of pid ${pid}`, `${prompt.where}, class ${prompt.className}`);
        return;
      }
      if (Date.now() - started >= WINDOW_WAIT_MS) this.require(false, `UI Automation sees the "${PROMPT_TITLE}" box of pid ${pid}`, JSON.stringify(last));
      await this.sleep(POLL_MS);
    }
  }

  async answerPrompt() {
    if (this.options.answer === 'manual') {
      this.log(`MANUAL: in the "${PROMPT_TITLE}" box click "${BUTTONS.now}" or "${BUTTONS.later}". Waiting up to ${seconds(MANUAL_WAIT_MS)}.`);
      const started = Date.now();
      for (;;) {
        const answered = findAnswer(parseLogLines(readAppended(this.logFile, this.runLogOffset)));
        if (answered !== null) {
          this.answer = answered;
          break;
        }
        if (Date.now() - started >= MANUAL_WAIT_MS) this.require(false, 'a person answered the prompt', `no answer within ${seconds(MANUAL_WAIT_MS)}`);
        await this.sleep(POLL_MS);
      }
      this.clickedBy = 'a person (--answer manual)';
    } else {
      await this.expectPromptWindow(this.appPid);
      const button = BUTTONS[this.answer];
      const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', UI_ANSWER, '-ProcessId', String(this.appPid), '-Title', PROMPT_TITLE, '-Button', button, '-TimeoutSeconds', String(UI_ANSWER_WAIT_S)];
      const result = await runProcess('powershell.exe', args, { timeoutMs: (UI_ANSWER_WAIT_S + 60) * 1000 });
      const output = `${result.stdout}${result.stderr}`.trim();
      for (const line of output.split(/\r?\n/)) if (line.trim()) this.log(`  ${line}`);
      this.require(!result.timedOut && result.status === 0, `scripts/ui-answer.ps1 pressed "${button}"`, result.timedOut ? 'it did not finish' : result.status === 0 ? '' : `exit ${result.status}`);
      this.clickedBy = 'UI Automation (scripts/ui-answer.ps1)';
    }
    await this.waitForLines({ from: this.runLogOffset, lines: [`INFO prompt answer ${this.answer}`], timeoutMs: LOG_LINE_WAIT_MS, what: 'the updater recording the answer', pid: this.appPid });
    this.mark(`answered ${this.answer} (${this.clickedBy})`);
  }

  // -- what follows each answer -----------------------------------------------------------------------------------

  async followNow() {
    await this.waitForLines({ from: this.runLogOffset, lines: [`INFO installing ${NEW_VERSION}`], timeoutMs: LOG_LINE_WAIT_MS, what: 'the updater starting the install' });
    const gone = await P.pidsGone([this.appPid], EXIT_WAIT_MS);
    this.require(gone.alive.length === 0, `the ${OLD_VERSION} app (pid ${this.appPid}) quit to install (Get-Process -Id)`, `after ${gone.ms} ms`);
    this.mark(`${OLD_VERSION} quit`);
    this.failOnForbiddenLines(`the ${OLD_VERSION} app started the installer`, this.runLogOffset);
    const boundary = fileSize(this.logFile);
    await this.waitForLines({ from: boundary, lines: [`INFO started ${this.logProduct} ${NEW_VERSION}`], timeoutMs: RELAUNCH_WAIT_MS, what: `the installer starting the installed ${NEW_VERSION} again` });
    this.mark(`started ${NEW_VERSION}`);
    const procs = await P.processes(this.work);
    const mains = procs.under.filter((p) => samePath(p.path, this.exe) && !/(^|\s)--type=/.test(p.commandLine || ''));
    this.require(mains.length === 1 && mains[0].pid !== this.appPid, `one new main process runs ${this.exe}`, mains.map((p) => `pid ${p.pid}: ${p.commandLine}`).join(' | ') || 'none');
    this.relaunchedCommandLine = mains[0].commandLine;
    await this.checkRelaunchedCopy(mains[0].pid, boundary);
  }

  async followLater() {
    const close = await runProcess('taskkill', ['/pid', String(this.appPid)], { timeoutMs: 30000 });
    this.require(close.status === 0, `taskkill /pid ${this.appPid} (no /F) asked the app to close`, `exit ${close.status}: ${firstLine(close.stdout) || firstLine(close.stderr)}`);
    const gone = await P.pidsGone([this.appPid], EXIT_WAIT_MS);
    this.require(gone.alive.length === 0, `the ${OLD_VERSION} app (pid ${this.appPid}) closed after the normal close`, `after ${gone.ms} ms`);
    this.mark(`${OLD_VERSION} closed normally`);
    await this.waitForDisplayVersion(NEW_VERSION);
    this.mark(`DisplayVersion ${NEW_VERSION}`);
    await this.waitForInstallerExit();
    const from = fileSize(this.logFile);
    const pid = await this.launch();
    this.mark(`started the installed exe again (pid ${pid})`);
    await this.checkRelaunchedCopy(pid, from);
  }

  async waitForDisplayVersion(version) {
    const started = Date.now();
    for (;;) {
      this.failOnForbiddenLines(`electron-updater installing ${version} at quit`, this.runLogOffset);
      const entries = await P.uninstallEntries(this.names.product);
      for (const e of entries) this.displayNames.add(e.displayName);
      if (entries.length === 1 && entries[0].displayVersion === version) {
        this.check(true, `the HKCU uninstall entry's DisplayVersion became ${version}`, `after ${seconds(Date.now() - started)}`);
        return;
      }
      if (Date.now() - started >= REGISTRY_WAIT_MS) this.require(false, `the HKCU uninstall entry's DisplayVersion became ${version}`, JSON.stringify(entries));
      await this.sleep(1000);
    }
  }

  async waitForInstallerExit() {
    const started = Date.now();
    for (;;) {
      const procs = await P.processes(this.cacheDir);
      if (procs.under.length === 0) return;
      if (Date.now() - started >= INSTALLER_DONE_WAIT_MS) this.require(false, 'the update installer finished', procs.under.map((p) => `${p.pid} ${p.path}`).join(', '));
      await this.sleep(1000);
    }
  }

  async checkRelaunchedCopy(pid, from) {
    const parsed = await this.waitForLines({
      from,
      lines: [`INFO started ${this.logProduct} ${NEW_VERSION}`, 'INFO checking', 'INFO update not available'],
      timeoutMs: RELAUNCH_WAIT_MS,
      what: `the installed ${NEW_VERSION} checking the feed and finding nothing newer`,
      pid,
    });
    const offered = parsed.filter((l) => l.message !== null && /^(update available|update downloaded|prompt answer) /.test(l.message));
    this.check(offered.length === 0, `the ${NEW_VERSION} copy logged no update available, update downloaded or prompt answer`, offered.map((l) => l.line).join(' | '));
    let windows;
    try {
      windows = await P.windows(pid);
    } catch (err) {
      windows = { error: firstLine(err) };
    }
    this.check(Array.isArray(windows) && windows.length > 0 && !findPrompt(windows), `pid ${pid} shows its window(s) and no "${PROMPT_TITLE}" box`, JSON.stringify(windows).slice(0, 300));
    const version = await P.fileVersion(this.exe);
    this.check(version.fileVersion === NEW_VERSION, `the installed ${this.names.exe} is ${NEW_VERSION} (FileVersion)`, `FileVersion ${version.fileVersion}, ProductVersion ${version.productVersion}`);
    const entries = await P.uninstallEntries(this.names.product);
    for (const e of entries) this.displayNames.add(e.displayName);
    this.check(entries.length === 1 && entries[0].displayVersion === NEW_VERSION, `the HKCU uninstall entry's DisplayVersion is ${NEW_VERSION}`, entries.map((e) => `"${e.displayName}" ${e.displayVersion}`).join(', ') || 'none');
    const cfg = fs.readFileSync(path.join(this.dirs.install, 'resources', 'app-update.yml'), 'utf8');
    this.check(yamlValue(cfg, 'url') === this.feedUrl, 'the updated install still reads the local feed', yamlValue(cfg, 'url'));
  }

  /** Informational: whether the update left the updater cache's marker (not pass/fail: Vitrine ships no custom NSIS). */
  noteUpdateCache() {
    const kept = this.cacheMarker !== null && pathExists(this.cacheMarker);
    this.log(`NOTE after the update the updater cache marker is ${kept ? 'still there' : 'gone (the cache was cleared by the update)'}`);
  }

  checkWholeLog() {
    const parsed = parseLogLines(readAppended(this.logFile, this.runLogOffset));
    const product = this.logProduct;
    const expected = [
      `INFO started ${product} ${OLD_VERSION}`,
      'INFO checking',
      `INFO update available ${NEW_VERSION}`,
      `INFO update downloaded ${NEW_VERSION}`,
      `INFO prompt answer ${this.answer}`,
      ...(this.answer === 'now' ? [`INFO installing ${NEW_VERSION}`] : []),
      `INFO started ${product} ${NEW_VERSION}`,
      'INFO checking',
      'INFO update not available',
    ];
    const { matched, missing } = matchInOrder(parsed, expected);
    this.matched = matched;
    this.check(missing === null, `updater.log, in order: ${expected.map((l) => l.replace(/^INFO /, '')).join(' -> ')}`, missing === null ? `${matched.length} lines` : `missing "${missing}"`);
    const count = (key) => parsed.filter((l) => l.key === key).length;
    const once = [`INFO started ${product} ${OLD_VERSION}`, `INFO started ${product} ${NEW_VERSION}`, `INFO update downloaded ${NEW_VERSION}`];
    if (this.answer === 'now') once.push(`INFO installing ${NEW_VERSION}`);
    for (const key of once) this.check(count(key) === 1, `exactly one "${key.replace(/^INFO /, '')}"`, String(count(key)));
    if (this.answer === 'later') this.check(count(`INFO installing ${NEW_VERSION}`) === 0, `no "installing ${NEW_VERSION}": Later leaves the install to the quit`);
    const bad = forbiddenLines(parsed);
    this.check(bad.length === 0, 'no ERROR line but the full-download fallback, and no restart-required, postponed, disabled or message-box-failed line', bad.map((l) => l.line).join(' | ') || 'none');
  }

  checkFeedRequests() {
    const requests = this.feed.requests;
    const installer = this.installerName(NEW_VERSION);
    const yml = requests.findIndex((r) => r.method === 'GET' && requestPath(r.url) === '/latest.yml' && r.status === 200);
    const payload = requests.findIndex((r, i) => i > yml && r.method === 'GET' && r.status === 200 && [`/${installer}`, `/${installer}.blockmap`].includes(requestPath(r.url)));
    this.check(yml >= 0 && payload > yml, 'the feed served latest.yml, then the installer or its blockmap', `requests ${yml} and ${payload} of ${requests.length}`);
    const full = requests.find((r) => r.method === 'GET' && requestPath(r.url) === `/${installer}` && r.status === 200);
    if (full) {
      const size = fs.statSync(path.join(this.dirs.B, installer)).size;
      this.check(full.complete && full.bytes === size, 'the installer went out whole', `${full.bytes} of ${size} bytes`);
    }
  }

  // -- teardown ------------------------------------------------------------------------------------------------------

  async teardown() {
    this.log('teardown');
    const step = async (what, fn) => {
      try {
        await fn();
      } catch (err) {
        this.check(false, `teardown: ${what}`, firstLine(err));
      }
    };
    if (this.touchedProfile) await step('wait for an update installer still running from the updater cache', () => this.waitForCacheProcesses());
    if (this.work) await step('stop the processes under the work folder', () => this.stopWorkProcesses());
    if (this.feed) await step('close the feed', () => this.closeFeed());
    if (this.touchedProfile) {
      await step('uninstall', () => this.uninstall());
      await step('check what the uninstaller removed and kept', () => this.checkUninstallFolders());
      await step('remove what the uninstaller left', () => this.removeLeftovers());
      await step('remove the app folders', () => this.removeAppFolders());
    }
    const keepWork = this.options.keep || this.options.stage === 'build';
    if (this.work && this.workIsOurs && !keepWork) await step('remove the work folder', () => removeDir(this.work));
    await step('after-run checks', () => this.afterRunChecks());
    this.mark('teardown');
  }

  async stopWorkProcesses() {
    const procs = await P.processes(this.work);
    if (procs.under.length === 0) {
      this.log('no process runs from the work folder');
      return;
    }
    const kills = planKills(procs);
    for (const pid of kills) {
      const r = await runProcess('taskkill', ['/pid', String(pid), '/F'], { timeoutMs: 30000 });
      this.log(`taskkill /pid ${pid} /F: exit ${r.status} ${firstLine(r.stdout) || firstLine(r.stderr)}`);
    }
    const gone = await P.pidsGone(kills, KILL_WAIT_MS);
    this.check(gone.alive.length === 0, `teardown: the processes that ran from the work folder are gone (Get-Process -Id ${kills.join(', ')})`, gone.alive.length ? `still there: ${gone.alive.join(', ')}` : `after ${gone.ms} ms`);
  }

  async closeFeed() {
    const started = Date.now();
    while (this.feed.openSockets() > 0 && Date.now() - started < SOCKET_DRAIN_MS) await delay(100);
    const left = this.feed.openSockets();
    await this.feed.close();
    this.log(`feed closed${left > 0 ? `, ${left} connection(s) reset` : ''}`);
  }

  async waitForCacheProcesses() {
    const started = Date.now();
    for (;;) {
      const procs = await P.processes(this.cacheDir);
      if (procs.under.length === 0) return;
      if (Date.now() - started >= INSTALLER_DONE_WAIT_MS) {
        this.check(false, 'teardown: no installer runs from the updater cache before the uninstall', procs.under.map((p) => `${p.pid} ${p.path}`).join(', '));
        return;
      }
      await delay(1000);
    }
  }

  /** Runs a copy of the uninstaller with `_?=<install>` so its end can be waited for. */
  async uninstall() {
    const uninstaller = path.join(this.dirs.install, this.names.uninstaller);
    if (!pathExists(uninstaller)) {
      if (this.seen.uninstallEntry) this.check(false, `teardown: "${this.names.uninstaller}" is in the install folder`, 'not found');
      else this.log('nothing was installed, so there is nothing to uninstall');
      return;
    }
    fs.mkdirSync(this.dirs.uninstaller, { recursive: true });
    const copy = path.join(this.dirs.uninstaller, this.names.uninstaller);
    fs.copyFileSync(uninstaller, copy);
    const spec = nsisSpawn(copy, ['/S', '/currentuser', `_?=${this.dirs.install}`]);
    this.beforeUninstall = { cacheDir: pathExists(this.cacheDir), userData: pathExists(this.userDataDir) };
    this.log(`uninstalling: "${copy}" ${spec.args.join(' ')}`);
    const result = await runProcess(spec.file, spec.args, { ...spec.options, env: childEnv(process.env), timeoutMs: INSTALL_WAIT_MS });
    this.check(!result.timedOut && result.status === 0, 'teardown: the uninstaller exited 0', result.timedOut ? `still running after ${seconds(INSTALL_WAIT_MS)}` : result.status === 0 ? '' : `exit ${result.status}`);
  }

  checkUninstallFolders() {
    if (this.beforeUninstall === null) return;
    this.log(`NOTE the uninstaller ${this.beforeUninstall.cacheDir && !pathExists(this.cacheDir) ? 'removed' : 'left'} the updater cache and ${pathExists(this.userDataDir) ? 'kept' : 'removed'} the userData folder`);
  }

  async removeLeftovers() {
    const install = this.dirs.install.toLowerCase();
    for (const entry of await P.uninstallEntries(this.names.product)) {
      if (nonEmpty(entry.uninstallString) && entry.uninstallString.toLowerCase().includes(install)) {
        const key = `${UNINSTALL_ROOT}\\${entry.key}`;
        const removed = await P.removeRegistryKey(key);
        this.check(false, 'teardown: the uninstaller removed its HKCU uninstall entry', `the harness removed ${key}: ${removed.removed}`);
      }
    }
    if (this.uninstallKey) {
      const key = await P.installKey(this.uninstallKey);
      if (key.exists && samePath(key.installLocation, this.dirs.install)) {
        const removed = await P.removeRegistryKey(key.key);
        this.check(false, `teardown: the uninstaller removed ${key.key}`, `the harness removed it: ${removed.removed}`);
      }
    }
    for (const s of await P.shortcuts(this.names.shortcut)) {
      if (s.exists && nonEmpty(s.target) && isInsideOrEqual(this.work, s.target)) {
        fs.rmSync(s.file, { force: true });
        this.check(false, `teardown: the uninstaller removed ${s.file}`, 'the harness removed it');
      }
    }
  }

  async removeAppFolders() {
    for (const dir of [this.userDataDir, this.cacheDir, this.homeLogDir]) {
      if (dir && pathExists(dir)) {
        await removeDir(dir);
        this.log(`removed ${dir}`);
      }
    }
  }

  async afterRunChecks() {
    const profile = this.touchedProfile;
    if (this.work) {
      const procs = await P.processes(this.work);
      const saw = this.appPid === null || (this.seen.processes || 0) > 0;
      this.check(procs.under.length === 0 && saw, `after the run: no process runs from ${this.work}`, procs.under.length ? procs.under.map((p) => `${p.pid} ${p.path}`).join(', ') : this.appPid === null ? 'none; the run started no installed app' : `none; the same probe saw ${this.seen.processes} process(es) while the app ran`);
    }
    if (this.portableKnown.length > 0) {
      const gone = await P.pidsGone(this.portableKnown.map((p) => p.pid), 0);
      this.check(gone.alive.length === 0, 'after the run: the portable build\'s processes are gone', gone.alive.join(', '));
    }
    if (this.feed) {
      const tcp = await P.tcp(this.port);
      const saw = (this.seen.listening || 0) > 0;
      this.check(tcp.length === 0 && saw, `after the run: Get-NetTCPConnection -LocalPort ${this.port} finds nothing`, tcp.length ? tcp.map((c) => `${c.localAddress}:${c.localPort}->${c.remoteAddress}:${c.remotePort} ${c.state}`).join(', ') : `nothing; it saw ${this.seen.listening} listener(s) while the feed ran`);
    }
    if (this.names && (profile || this.refused === null)) {
      const entries = await P.uninstallEntries(this.names.product);
      const byGuid = (await P.keysExist([`${UNINSTALL_ROOT}\\${this.guid}`])).filter((k) => k.exists);
      const sawEntry = !profile || Boolean(this.seen.uninstallEntry);
      this.check(entries.length === 0 && byGuid.length === 0 && sawEntry, `after the run: no HKCU uninstall entry named ${this.names.product} and no ...\\Uninstall\\${this.guid}`, entries.length || byGuid.length ? 'still there' : sawEntry ? `none; the run saw ${this.seen.uninstallEntry || 'no install'}` : 'none, but the entry was never seen');
      const key = await P.installKey(this.guid);
      const sawKey = !profile || this.seen.installKey === true;
      this.check(!key.exists && sawKey, `after the run: no ${key.key}`, key.exists ? `InstallLocation ${key.installLocation}` : 'gone');
      for (const s of await P.shortcuts(this.names.shortcut)) {
        const saw = !profile || (this.seen.shortcutFiles || []).some((f) => samePath(f, s.file));
        this.check(!s.exists && nonEmpty(s.folder) && saw, `after the run: no ${s.file}`, s.exists ? `still there, pointing at ${s.target}` : 'gone');
      }
      for (const [dir, sawIt] of [[this.userDataDir, this.seen.userData === true], [this.cacheDir, this.seen.cacheDir === true], [this.homeLogDir, this.seen.homeLogs === true]]) {
        const saw = !profile || sawIt;
        const exists = pathExists(dir);
        this.check(!exists && saw, `after the run: no ${dir}`, exists ? 'still there' : saw ? 'gone' : 'gone, but it was never seen, so this proves nothing');
      }
    }
    const keepWork = this.options.keep || this.options.stage === 'build';
    if (this.work && !keepWork) this.check(!pathExists(this.work), `after the run: no ${this.work}`);
  }

  printSummary() {
    const out = ['', '===== update-e2e summary ====='];
    out.push(`stage: ${this.options.stage}; answer: ${this.answer === null ? `${this.options.answer}, never given` : this.answer}; clicked by: ${this.clickedBy || 'nobody'}`);
    out.push(`work folder: ${this.work || 'none'}${this.work ? (fs.existsSync(this.work) ? ' (still there)' : ' (removed)') : ''}`);
    if (this.feedUrl) out.push(`feed: ${this.feedUrl}`);
    if (this.displayNames.size > 0) out.push(`HKCU uninstall DisplayName seen: ${[...this.displayNames].map((n) => `"${n}"`).join(', ')}`);
    if (this.relaunchedCommandLine) out.push(`the relaunched main process's command line: ${this.relaunchedCommandLine}`);
    out.push('timings:');
    for (let i = 1; i < this.marks.length; i++) out.push(`  ${seconds(this.marks[i].at - this.marks[i - 1].at).padStart(9)}  ${this.marks[i].name}`);
    if (this.feed) {
      out.push(`feed requests (${this.feed.requests.length}):`);
      for (const r of this.feed.requests) out.push(`  ${formatRequest(r, this.feedStartedAt)}`);
    }
    if (this.logText !== null) {
      const lines = parseLogLines(this.logText);
      out.push(`updater.log, every line this run appended (${lines.length}; the portable build's first):`);
      for (const l of lines) out.push(`  ${l.line}`);
    }
    const failed = this.checks.filter((c) => !c.passed);
    out.push(`checks: ${this.checks.length - failed.length} passed, ${failed.length} failed`);
    for (const c of this.checks) out.push(`  ${c.passed ? 'PASS' : 'FAIL'} ${c.what}${c.detail ? ` (${c.detail})` : ''}`);
    if (this.refused) out.push(`refused: ${this.refused}`);
    if (this.error) out.push(`error: ${firstLine(this.error)}`);
    if (this.aborted) out.push(`stopped by ${this.aborted}`);
    out.push(`VERDICT: ${this.passed() ? 'PASS' : 'FAIL'}`);
    for (const line of out) this.print(line);
  }
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.log(`update-e2e: ${err.message}`);
    console.log(USAGE);
    return 2;
  }
  const harness = new Harness(options);
  const signals = ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'];
  const onSignal = (signal) => {
    if (harness.aborted) {
      console.log(`update-e2e: ${signal} again: exiting without the rest of the teardown`);
      process.exit(1);
    }
    console.log(`update-e2e: ${signal}: stopping; the teardown runs next`);
    harness.abort(signal);
  };
  const onUncaught = (err) => harness.crash(err, 'uncaughtException');
  const onRejection = (err) => harness.crash(err, 'unhandledRejection');
  for (const signal of signals) process.on(signal, onSignal);
  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onRejection);
  try {
    return await harness.run();
  } finally {
    for (const signal of signals) process.removeListener(signal, onSignal);
    process.removeListener('uncaughtException', onUncaught);
    process.removeListener('unhandledRejection', onRejection);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
      setTimeout(() => process.exit(code), 5000).unref();
    },
    (err) => {
      console.error(`update-e2e: ${err && err.stack ? err.stack : err}`);
      process.exitCode = 1;
      setTimeout(() => process.exit(1), 5000).unref();
    },
  );
}

module.exports = { IDENTITY, parseArgs, parseLatestYml, parseLogLines, matchInOrder, forbiddenLines, nsisGuid, descendantsOf, planKills };
