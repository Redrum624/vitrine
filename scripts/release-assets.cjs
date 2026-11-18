'use strict';
/**
 * Pure release checks for gh-release.cjs and check-update-feed.cjs (no network, no process.exit).
 *
 * electron-updater finds a release only through GitHub's "latest" release and that release's
 * latest.yml (GitHubProvider: /releases/latest as JSON for the tag, then
 * /releases/download/<tag>/latest.yml). The installer, latest.yml and the blockmap are what it needs:
 * a release without them, left as draft or prerelease, or with a latest.yml that does not describe
 * the uploaded installer is invisible or unverifiable for every installed copy.
 *
 * Each check is { name, error }: error is null when the check passes. The *Errors functions return
 * only the error strings; check-update-feed.cjs prints every check as PASS/FAIL.
 */
const { validateLatestYml } = require('./collect-installer.cjs');

function requiredAssets(version) {
  return [`Vitrine-Setup-${version}.exe`, `Vitrine-Setup-${version}.exe.blockmap`, 'latest.yml'];
}

/** @param {string[]} present file names found in release/ @returns {string[]} required names that are absent */
function missingRequired(present, version) {
  return requiredAssets(version).filter((n) => !present.includes(n));
}

/**
 * Reads the fields electron-updater uses from latest.yml, with the line rules validateLatestYml
 * (collect-installer.cjs) applies: top-level `key: value` lines, and the `files:` block's
 * `- url:` entries with their `sha512:` / `size:` lines. No YAML dependency.
 * @returns {{ version?: string, path?: string, sha512?: string, files: Array<{ url?: string, sha512?: string, size?: string }> }}
 */
function readLatestYml(ymlText) {
  const unq = (v) => v.replace(/^['"]|['"]$/g, '');
  const top = (key) => {
    const m = ymlText.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
    return m ? unq(m[1]) : undefined;
  };
  const files = [];
  let inFiles = false;
  for (const line of ymlText.split('\n')) {
    if (/^files:\s*$/.test(line)) { inFiles = true; continue; }
    if (inFiles && /^\S/.test(line)) inFiles = false;
    if (!inFiles) continue;
    const m = line.match(/^\s*(-\s+)?(url|sha512|size):\s*(.+?)\s*$/);
    if (!m) continue;
    if (m[1] && m[2] === 'url') files.push({});
    if (files.length) files[files.length - 1][m[2]] = unq(m[3]);
  }
  return { version: top('version'), path: top('path'), sha512: top('sha512'), files };
}

const errorsOf = (checks) => checks.filter((c) => c.error).map((c) => c.error);

/**
 * The gate gh-release.cjs runs before it uploads anything: release/latest.yml must describe the
 * installer in release/ (name, sha512, size: validateLatestYml) and carry the package version.
 * @returns {string[]} errors, empty when the release may go ahead
 */
function preUploadErrors(ymlText, { installerName, installerSha512, installerSize, version }) {
  const errors = [...validateLatestYml(ymlText, installerName, installerSha512, installerSize).errors];
  const ymlVersion = readLatestYml(ymlText).version;
  if (ymlVersion !== version) {
    errors.push(`latest.yml version ${ymlVersion} != package.json version ${version}`);
  }
  return errors;
}

/**
 * Checks on `gh release view v<version> --json isDraft,isPrerelease,tagName,assets`.
 * installerSize undefined skips the size comparison (check-update-feed.cjs has no local installer).
 * @returns {Array<{ name: string, error: string|null }>}
 */
function readbackChecks(release, { version, installerName = `Vitrine-Setup-${version}.exe`, installerSize }) {
  const tag = `v${version}`;
  const view = release || {};
  const assets = Array.isArray(view.assets) ? view.assets : [];
  const byName = new Map(assets.map((a) => [a.name, a]));
  const checks = [];
  const check = (name, error) => checks.push({ name, error: error || null });

  check(`${tag} is published, not a draft`,
    view.isDraft !== false && `release ${tag} is a draft (isDraft: ${view.isDraft}): installed copies cannot see it`);
  check(`${tag} is not a prerelease`,
    view.isPrerelease !== false && `release ${tag} is a prerelease (isPrerelease: ${view.isPrerelease}): installed copies skip it`);
  check(`tag is ${tag}`, view.tagName !== tag && `release tag is ${view.tagName}, expected ${tag}`);
  const blockmap = `${installerName}.blockmap`;
  for (const name of [installerName, blockmap, 'latest.yml']) {
    check(`asset ${name} is on the release`, !byName.has(name) && `required asset ${name} is missing from release ${tag}`);
  }
  const notUploaded = assets.filter((a) => a.state !== 'uploaded');
  check('every asset is uploaded', notUploaded.length > 0 &&
    `asset(s) not uploaded on ${tag}: ${notUploaded.map((a) => `${a.name} (state: ${a.state})`).join(', ')}`);
  const installer = byName.get(installerName);
  if (installer && installerSize !== undefined) {
    check(`${installerName} size is ${installerSize}`, installer.size !== installerSize &&
      `asset ${installerName} size ${installer.size} != local installer size ${installerSize}`);
  }
  const yml = byName.get('latest.yml');
  if (yml) check('latest.yml is not empty', yml.size === 0 && `asset latest.yml on ${tag} is empty (size 0)`);
  return checks;
}

/** @returns {string[]} */
function releaseReadbackErrors(view, opts) {
  return errorsOf(readbackChecks(view, opts));
}

/**
 * Checks on the live feed, as an installed copy reads it: latestTag from /releases/latest,
 * latestYmlText from /releases/download/<latestTag>/latest.yml, view the release v<version>.
 * @returns {Array<{ name: string, error: string|null }>}
 */
function feedChecks({ latestTag, latestYmlText, view, version }) {
  const tag = `v${version}`;
  const assets = Array.isArray(view && view.assets) ? view.assets : [];
  const byName = new Map(assets.map((a) => [a.name, a]));
  const yml = readLatestYml(latestYmlText || '');
  const first = yml.files[0] || {};
  const checks = [];
  const check = (name, error) => checks.push({ name, error: error || null });

  check(`/releases/latest is ${tag}`, latestTag !== tag &&
    `GitHub's latest release is ${latestTag}, expected ${tag}: installed copies do not see ${tag}`);
  check(`latest.yml version is ${version}`, yml.version !== version &&
    `the live latest.yml says version ${yml.version}, expected ${version}`);
  check('latest.yml path is an asset', !byName.has(yml.path) &&
    `the live latest.yml path "${yml.path}" is not an asset of release ${tag}`);
  check('latest.yml files[0].url is an asset', !byName.has(first.url) &&
    `the live latest.yml files[0].url "${first.url}" is not an asset of release ${tag}`);
  const asset = byName.get(first.url);
  if (asset) {
    check('latest.yml files[0].size is the asset size', Number(first.size) !== asset.size &&
      `the live latest.yml files[0].size ${first.size} != asset ${asset.name} size ${asset.size}`);
  }
  return checks;
}

/** @returns {string[]} */
function feedErrors(args) {
  return errorsOf(feedChecks(args));
}

module.exports = {
  requiredAssets,
  missingRequired,
  readLatestYml,
  preUploadErrors,
  readbackChecks,
  releaseReadbackErrors,
  feedChecks,
  feedErrors,
};
