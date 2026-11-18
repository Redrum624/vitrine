const fs = require('fs');
const nodePath = require('path');
const { validateLatestYml } = require('../../scripts/collect-installer.cjs');
const {
  missingRequired, releaseReadbackErrors, feedErrors, preUploadErrors,
} = require('../../scripts/release-assets.cjs');
const { sumDownloads } = require('../../.github/scripts/sample-downloads.cjs');

// Real GitHub answers for v1.40.0, recorded 2026-11-18 (see fixtures/update-feed). No test here
// touches the network: the scripts' I/O lives in check-update-feed.cjs and is not required.
const FIX = nodePath.join(__dirname, 'fixtures', 'update-feed');
const readFix = (name: string): string => fs.readFileSync(nodePath.join(FIX, name), 'utf8');
const VIEW = JSON.parse(readFix('gh-release-view-v1.40.0.json'));
const LATEST_YML = readFix('latest-v1.40.0.yml');
const LATEST_TAG: string = JSON.parse(readFix('releases-latest.json')).tag_name;
const SETUP = 'Vitrine-Setup-1.40.0.exe';
const SETUP_SIZE = 312072371;
const SETUP_SHA512 = 'DmJXJ2UqmueJn+YAS6SyjGxjPMVndW+arBrewlGUDn8s8qB1zz7ECphKYw76XNPVBZlcM0rda2PkPbZhBBHj/Q==';

type Asset = { name: string; size: number; state: string };
const cloneView = () => JSON.parse(JSON.stringify(VIEW));
const withoutAsset = (name: string) => {
  const v = cloneView();
  v.assets = v.assets.filter((a: Asset) => a.name !== name);
  expect(v.assets).toHaveLength(VIEW.assets.length - 1);
  return v;
};
const patchAsset = (name: string, patch: Partial<Asset>) => {
  const v = cloneView();
  Object.assign(v.assets.find((a: Asset) => a.name === name), patch);
  return v;
};
/** Replace one exact piece of the recorded latest.yml; fails if the piece is not there. */
const mutateYml = (from: string, to: string) => {
  expect(LATEST_YML).toContain(from);
  return LATEST_YML.replace(from, to);
};

const NAME = 'Vitrine-Setup-1.40.0.exe';
const SHA = 'abc123+/==';
const yml = (url: string, sha: string, path = url) =>
  `version: 1.40.0\nfiles:\n  - url: ${url}\n    sha512: ${sha}\n    size: 123\npath: ${path}\nsha512: ${sha}\nreleaseDate: '2026-10-14T00:00:00.000Z'\n`;

describe('validateLatestYml', () => {
  it('accepts a matching name and sha512', () => {
    expect(validateLatestYml(yml(NAME, SHA), NAME, SHA)).toEqual({ ok: true, errors: [] });
  });
  it('rejects a mismatched sha512', () => {
    const r = validateLatestYml(yml(NAME, SHA), NAME, 'other');
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/sha512/);
  });
  it('rejects a mismatched file name (url and path)', () => {
    const r = validateLatestYml(yml('Vitrine Setup 1.40.0.exe', SHA), NAME, SHA);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/url/);
    expect(r.errors.join(' ')).toMatch(/path/);
  });
  it('rejects a mismatched files[].sha512 even when the top-level one matches', () => {
    const y = `version: 1.40.0
files:
  - url: ${NAME}
    sha512: WRONG
    size: 123
path: ${NAME}
sha512: ${SHA}
`;
    const r = validateLatestYml(y, NAME, SHA, 123);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/files\[\]\.sha512/);
  });
  it('rejects a files[].size mismatch', () => {
    const r = validateLatestYml(yml(NAME, SHA), NAME, SHA, 999);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/size/);
  });
  it('rejects a file with no path/sha512/url', () => {
    expect(validateLatestYml('version: 1.40.0\n', NAME, SHA).ok).toBe(false);
  });
});

describe('sumDownloads', () => {
  it('counts only .exe assets', () => {
    const releases = [{
      tag_name: 'v1.40.0',
      assets: [
        { name: 'Vitrine-Setup-1.40.0.exe', download_count: 5 },
        { name: 'Vitrine-1.40.0-portable.exe', download_count: 2 },
        { name: 'latest.yml', download_count: 900 },
        { name: 'Vitrine-Setup-1.40.0.exe.blockmap', download_count: 40 },
        { name: 'SHA256SUMS.txt', download_count: 3 },
      ],
    }];
    expect(sumDownloads(releases)).toEqual({ total: 7, by_release: { 'v1.40.0': 7 } });
  });
});

describe('missingRequired (gh-release)', () => {
  const all = ['Vitrine-Setup-1.40.0.exe', 'Vitrine-Setup-1.40.0.exe.blockmap', 'latest.yml'];
  it('is empty when installer, blockmap and latest.yml are present', () => {
    expect(missingRequired([...all, 'LICENSE'], '1.40.0')).toEqual([]);
  });
  it.each(all)('flags %s when missing', (name) => {
    expect(missingRequired(all.filter((n) => n !== name), '1.40.0')).toEqual([name]);
  });
  it('does not require optional assets', () => {
    expect(missingRequired(all, '1.40.0')).toEqual([]);
  });
});

describe('releaseReadbackErrors (the published release, read back with gh release view)', () => {
  const opts = { version: '1.40.0', installerName: SETUP, installerSize: SETUP_SIZE };

  it('passes the recorded v1.40.0 release', () => {
    expect(releaseReadbackErrors(VIEW, opts)).toEqual([]);
  });

  it.each([
    ['a draft', () => ({ ...cloneView(), isDraft: true }), /draft/],
    ['a prerelease', () => ({ ...cloneView(), isPrerelease: true }), /prerelease/],
    ['the tag v1.39.0', () => ({ ...cloneView(), tagName: 'v1.39.0' }), /v1\.39\.0/],
    ['latest.yml missing', () => withoutAsset('latest.yml'), /latest\.yml/],
    ['the blockmap missing', () => withoutAsset(`${SETUP}.blockmap`), /\.blockmap/],
    ['the installer missing', () => withoutAsset(SETUP), /Vitrine-Setup-1\.40\.0\.exe\b(?!\.blockmap)/],
    ['the installer size off by one', () => patchAsset(SETUP, { size: SETUP_SIZE + 1 }), /312072372/],
    ['an asset whose state is not uploaded', () => patchAsset(`${SETUP}.blockmap`, { state: 'open' }), /open/],
    ['an empty latest.yml', () => patchAsset('latest.yml', { size: 0 }), /latest\.yml/],
  ])('flags %s with exactly one error', (_label, make, re) => {
    const errors = releaseReadbackErrors(make(), opts);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(re);
  });
});

describe('feedErrors (what an installed copy reads: /releases/latest, then its latest.yml)', () => {
  const feed = (over: Record<string, unknown> = {}) =>
    ({ latestTag: LATEST_TAG, latestYmlText: LATEST_YML, view: VIEW, version: '1.40.0', ...over });

  it('passes the three recorded answers', () => {
    expect(LATEST_TAG).toBe('v1.40.0');
    expect(feedErrors(feed())).toEqual([]);
  });

  it.each([
    ['the latest tag v1.39.0', () => feed({ latestTag: 'v1.39.0' }), /v1\.39\.0/],
    ['latest.yml version 1.39.0', () => feed({ latestYmlText: mutateYml('version: 1.40.0', 'version: 1.39.0') }), /1\.39\.0/],
    ['latest.yml path naming no asset',
      () => feed({ latestYmlText: mutateYml(`path: ${SETUP}`, 'path: Vitrine Setup 1.40.0.exe') }), /Vitrine Setup 1\.40\.0\.exe/],
    ['latest.yml files[0].url naming no asset',
      () => feed({ latestYmlText: mutateYml(`- url: ${SETUP}`, '- url: Vitrine Setup 1.40.0.exe') }), /Vitrine Setup 1\.40\.0\.exe/],
    ['files[0].size not the asset size',
      () => feed({ latestYmlText: mutateYml(`size: ${SETUP_SIZE}`, `size: ${SETUP_SIZE - 1}`) }), /312072370/],
  ])('flags %s with exactly one error', (_label, make, re) => {
    const errors = feedErrors(make());
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(re);
  });
});

describe('preUploadErrors (gh-release.cjs gate, before anything is published)', () => {
  const gate = { installerName: SETUP, installerSha512: SETUP_SHA512, installerSize: SETUP_SIZE, version: '1.40.0' };

  it('passes the recorded latest.yml against its own installer', () => {
    expect(preUploadErrors(LATEST_YML, gate)).toEqual([]);
  });
  it('fails when latest.yml version is not the package version', () => {
    const errors = preUploadErrors(LATEST_YML, { ...gate, version: '1.40.1' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/version 1\.40\.0.*1\.40\.1/);
  });
  it('fails when the installer sha512 does not match latest.yml', () => {
    const errors = preUploadErrors(LATEST_YML, { ...gate, installerSha512: 'other' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toMatch(/sha512/);
  });
});
