'use strict';
/**
 * Pure asset-list check for gh-release.cjs. The installer, latest.yml and the
 * blockmap are what electron-updater needs: a release without them breaks
 * updates for every installed copy, so their absence is fatal. Everything else
 * is optional.
 */
function requiredAssets(version) {
  return [`Vitrine-Setup-${version}.exe`, `Vitrine-Setup-${version}.exe.blockmap`, 'latest.yml'];
}

/** @param {string[]} present file names found in release/ @returns {string[]} required names that are absent */
function missingRequired(present, version) {
  return requiredAssets(version).filter((n) => !present.includes(n));
}

module.exports = { requiredAssets, missingRequired };
