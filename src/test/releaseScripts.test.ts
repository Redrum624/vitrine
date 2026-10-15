const { validateLatestYml } = require('../../scripts/collect-installer.cjs');
const { missingRequired } = require('../../scripts/release-assets.cjs');
const { sumDownloads } = require('../../.github/scripts/sample-downloads.cjs');

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
