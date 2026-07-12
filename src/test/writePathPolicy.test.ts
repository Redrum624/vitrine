/**
 * Write-path security policy (round-10 H2 finding #1).
 *
 * Pins BOTH hardening layers of electron/writePathPolicy.cjs at the pure validator:
 *  1. the deny-list now covers user-writable AUTORUN SINKS (per-user Startup, the
 *     PowerShell profile dirs, ~/.ssh) on top of the system dirs — a compromised
 *     renderer must not be able to write a payload there and escalate a file-write
 *     into persistent code execution; and
 *  2. the extension allow-list rejects anything that isn't a benign image/sidecar/data
 *     file when a caller opts in (write-file / write-image-file do).
 * Environment-derived paths are passed in explicitly so the check resolves identically
 * on any host running the suite.
 */
const path = require('node:path');
const {
  computeDeniedBases,
  validateWritePath,
  isAllowedWriteExtension,
  ALLOWED_WRITE_EXTENSIONS,
  REJECT_PREFIX,
} = require('../../electron/writePathPolicy.cjs') as {
  computeDeniedBases: (o: Record<string, unknown>) => string[];
  validateWritePath: (p: unknown, opts?: { deniedBases?: string[]; requireAllowedExtension?: boolean; realDir?: string }) => string;
  isAllowedWriteExtension: (p: string) => boolean;
  ALLOWED_WRITE_EXTENSIONS: Set<string>;
  REJECT_PREFIX: string;
};

const env = {
  SystemRoot: 'C:\\Windows',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  APPDATA: 'C:\\Users\\Tester\\AppData\\Roaming',
};
const homeDir = 'C:\\Users\\Tester';
const resourcesPath = 'C:\\Program Files\\Vitrine\\resources';
const installDir = 'C:\\Program Files\\Vitrine';

const R = (p: string) => path.resolve(p).toLowerCase();
const bases = () => computeDeniedBases({ env, homeDir, resourcesPath, installDir });

describe('writePathPolicy — computeDeniedBases (autorun sinks + system dirs)', () => {
  it('includes the system dirs, resources, and install dir', () => {
    const b = bases();
    expect(b).toContain(R('C:\\Windows'));
    expect(b).toContain(R('C:\\Program Files'));
    expect(b).toContain(R('C:\\Program Files (x86)'));
    expect(b).toContain(R(resourcesPath));
    expect(b).toContain(R(installDir));
  });

  it('includes the per-user Startup folder, PowerShell profile dirs, and ~/.ssh', () => {
    const b = bases();
    expect(b).toContain(R(path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')));
    expect(b).toContain(R(path.join(homeDir, 'Documents', 'WindowsPowerShell')));
    expect(b).toContain(R(path.join(homeDir, 'Documents', 'PowerShell')));
    expect(b).toContain(R(path.join(homeDir, '.ssh')));
  });

  it('derives the Startup folder from an explicit appDataDir when Electron supplies one', () => {
    const b = computeDeniedBases({ env: {}, homeDir, appDataDir: env.APPDATA });
    expect(b).toContain(R(path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')));
  });

  it('tolerates a sparse environment (no throw, only defined bases)', () => {
    expect(() => computeDeniedBases({})).not.toThrow();
    expect(computeDeniedBases({})).toEqual([]);
  });
});

describe('writePathPolicy — validateWritePath deny-list', () => {
  it('rejects a payload dropped into the per-user Startup folder', () => {
    const evil = path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'evil.lnk');
    expect(() => validateWritePath(evil, { deniedBases: bases() })).toThrow(REJECT_PREFIX);
  });

  it('rejects a write into a PowerShell profile dir and into ~/.ssh', () => {
    const profile = path.join(homeDir, 'Documents', 'WindowsPowerShell', 'profile.ps1');
    const sshKey = path.join(homeDir, '.ssh', 'authorized_keys');
    expect(() => validateWritePath(profile, { deniedBases: bases() })).toThrow(REJECT_PREFIX);
    expect(() => validateWritePath(sshKey, { deniedBases: bases() })).toThrow(REJECT_PREFIX);
  });

  it('rejects a system location and a traversal that resolves back into one', () => {
    expect(() => validateWritePath('C:\\Windows', { deniedBases: bases() })).toThrow(REJECT_PREFIX);
    const traversal = path.join(homeDir, 'Pictures', '..', '..', '..', 'Windows', 'System32', 'x.jpg');
    // Resolves to C:\Windows\System32\x.jpg → under the SystemRoot base.
    expect(() => validateWritePath(traversal, { deniedBases: bases() })).toThrow(REJECT_PREFIX);
  });

  it('allows an ordinary user export path (Pictures, and plain Documents)', () => {
    const pic = path.join(homeDir, 'Pictures', 'out.jpg');
    const doc = path.join(homeDir, 'Documents', 'export.jpg'); // Documents itself is NOT denied
    expect(validateWritePath(pic, { deniedBases: bases() })).toBe(path.resolve(pic));
    expect(validateWritePath(doc, { deniedBases: bases() })).toBe(path.resolve(doc));
  });

  it('rejects empty / non-string paths', () => {
    expect(() => validateWritePath('', { deniedBases: bases() })).toThrow('Invalid write path');
    expect(() => validateWritePath('   ', { deniedBases: bases() })).toThrow('Invalid write path');
    expect(() => validateWritePath(undefined, { deniedBases: bases() })).toThrow('Invalid write path');
  });
});

describe('writePathPolicy — extension allow-list', () => {
  it('exposes exactly the benign image/sidecar/data extensions', () => {
    expect([...ALLOWED_WRITE_EXTENSIONS].sort()).toEqual(
      ['.icc', '.jpeg', '.jpg', '.json', '.log', '.png', '.tif', '.tiff', '.webp', '.xmp'].sort()
    );
  });

  it('isAllowedWriteExtension is case-insensitive and rejects executables/scripts', () => {
    expect(isAllowedWriteExtension('a.JPG')).toBe(true);
    expect(isAllowedWriteExtension('a.xmp')).toBe(true);
    expect(isAllowedWriteExtension('a.exe')).toBe(false);
    expect(isAllowedWriteExtension('a.bat')).toBe(false);
    expect(isAllowedWriteExtension('a.ps1')).toBe(false);
    expect(isAllowedWriteExtension('noext')).toBe(false);
  });

  it('rejects a disallowed extension only when requireAllowedExtension is set', () => {
    const payload = path.join(homeDir, 'Pictures', 'payload.exe');
    // Off by default (rating/metadata handlers pass RAW paths) → deny-list only.
    expect(validateWritePath(payload, { deniedBases: bases() })).toBe(path.resolve(payload));
    // On for write-file / write-image-file → rejected.
    expect(() => validateWritePath(payload, { deniedBases: bases(), requireAllowedExtension: true })).toThrow(REJECT_PREFIX);
  });

  it('allows a normal export when requireAllowedExtension is set', () => {
    const jpg = path.join(homeDir, 'Pictures', 'out.jpg');
    expect(validateWritePath(jpg, { deniedBases: bases(), requireAllowedExtension: true })).toBe(path.resolve(jpg));
  });
});

// These only bite on a real Windows filesystem's segment semantics; path.sep differs on
// POSIX CI so the deny-list separators won't line up. The repo ships/tests on Windows.
const onWindows = path.sep === '\\';
(onWindows ? describe : describe.skip)('writePathPolicy — canonicalization hardening (round-10 review)', () => {
  it('denies a TRAILING-DOT segment bypass into an autorun sink (OS strips the dot)', () => {
    // `...\Startup.\evil.lnk` reaches the real Startup dir but a raw string-prefix on the
    // resolved path would miss it — canonicalizeForCompare folds the trailing dot.
    const evil = path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup.', 'evil.lnk');
    expect(() => validateWritePath(evil, { deniedBases: bases() })).toThrow(REJECT_PREFIX);
  });

  it('denies a TRAILING-SPACE segment bypass into a system dir', () => {
    const evil = 'C:\\Windows \\System32\\x.dll';
    expect(() => validateWritePath(evil, { deniedBases: bases() })).toThrow(REJECT_PREFIX);
  });

  it('honors a realDir (realpath of the parent) so an 8.3 / symlinked parent still resolves to the sink', () => {
    // Simulate main.cjs having realpath-resolved the parent (PROGRA~1 → Program Files):
    // the leaf is written under the install dir, which is denied.
    const realDir = installDir; // the true, long-form parent
    const viaShort = 'C:\\PROGRA~1\\Vitrine\\evil.exe';
    expect(() => validateWritePath(viaShort, { deniedBases: bases(), realDir })).toThrow(REJECT_PREFIX);
  });

  it('a realDir pointing at an ordinary folder still allows the write', () => {
    const realDir = path.join(homeDir, 'Pictures');
    const ok = path.join(homeDir, 'Pictures', 'out.jpg');
    expect(validateWritePath(ok, { deniedBases: bases(), realDir })).toBe(path.resolve(realDir, 'out.jpg'));
  });

  it('denies a Win32 verbatim-namespace prefix (\\\\?\\) bypass into a sink — pure validator, no realDir', () => {
    // path.resolve PRESERVES \\?\, so without prefix-neutralization this string-prefix-misses
    // the drive-letter deny-base. The pure validator must reject it on its own.
    const evil = '\\\\?\\' + path.join(homeDir, '.ssh', 'authorized_keys');
    expect(() => validateWritePath(evil, { deniedBases: bases() })).toThrow(REJECT_PREFIX);
  });

  it('denies a Win32 device-namespace prefix (\\\\.\\) bypass into a system dir', () => {
    const evil = '\\\\.\\C:\\Windows\\System32\\evil.dll';
    expect(() => validateWritePath(evil, { deniedBases: bases() })).toThrow(REJECT_PREFIX);
  });

  it('FAILS CLOSED on a Volume-GUID device root (aliases C: — no string fold possible)', () => {
    // \\?\Volume{GUID}\ names the same volume as C: under a root the deny-list can't match;
    // the fail-closed guard rejects the whole non-drive/non-UNC root class via the PURE validator.
    const evil = '\\\\?\\Volume{0f0c1594-1111-2222-3333-444455556666}\\Windows\\System32\\evil.dll';
    expect(() => validateWritePath(evil, { deniedBases: bases() })).toThrow(REJECT_PREFIX);
  });

  it('FAILS CLOSED on a GLOBALROOT device path', () => {
    const evil = '\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1\\Windows\\System32\\evil.dll';
    expect(() => validateWritePath(evil, { deniedBases: bases() })).toThrow(REJECT_PREFIX);
  });

  it('still allows a plain UNC-share export target (\\\\server\\share)', () => {
    const unc = '\\\\nas\\photos\\out.jpg';
    // Not under any local deny-base and rooted at a real UNC share → allowed.
    expect(validateWritePath(unc, { deniedBases: bases() })).toBe(path.resolve(unc));
  });
});
