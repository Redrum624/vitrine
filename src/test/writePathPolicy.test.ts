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
  validateWritePath: (p: unknown, opts?: { deniedBases?: string[]; requireAllowedExtension?: boolean }) => string;
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
const resourcesPath = 'C:\\Program Files\\Photo Editor Pro\\resources';
const installDir = 'C:\\Program Files\\Photo Editor Pro';

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
