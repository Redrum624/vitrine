/**
 * Unit tests for scripts/reset-smoke-fixtures.cjs's key-matching logic ONLY.
 *
 * Per the task brief, this does NOT run the script against the real AppData store —
 * it verifies (a) the `edits:<path>` key format exactly mirrors
 * EditPersistenceService.keyForPath(), (b) the sha1-based store filename exactly
 * mirrors storeFilePath() in electron/main.cjs, and (c) the image-file discovery +
 * deletion-planning logic operate correctly against a throwaway temp directory
 * (never the real fixture folder or the real %APPDATA% store).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// Plain Node .cjs script (no ts-jest transform needed) — require, not import, since it has no type declarations.
const resetSmokeFixtures = require('../../scripts/reset-smoke-fixtures.cjs');

describe('reset-smoke-fixtures.cjs — key-matching logic', () => {
  it('keyForPath mirrors EditPersistenceService.keyForPath()\'s "edits:<path>" format', () => {
    expect(resetSmokeFixtures.keyForPath('C:\\fixtures\\a.orf')).toBe('edits:C:\\fixtures\\a.orf');
    expect(resetSmokeFixtures.keyForPath('/mnt/fixtures/a.orf')).toBe('edits:/mnt/fixtures/a.orf');
  });

  it('storeFilePath hashes the key the exact same way electron/main.cjs\'s storeFilePath() does (sha1 hex + .json)', () => {
    const key = 'edits:C:\\fixtures\\a.orf';
    const expectedHash = crypto.createHash('sha1').update(key).digest('hex');
    const storeDir = 'C:\\Users\\someone\\AppData\\Roaming\\photo_app\\store';

    const result = resetSmokeFixtures.storeFilePath(storeDir, key);

    expect(result).toBe(path.join(storeDir, `${expectedHash}.json`));
  });

  it('getUserDataStoreDir builds <APPDATA>/<appName>/store from the environment', () => {
    const prevAppData = process.env.APPDATA;
    try {
      process.env.APPDATA = 'C:\\Users\\someone\\AppData\\Roaming';
      const dir = resetSmokeFixtures.getUserDataStoreDir('photo_app');
      expect(dir).toBe(path.join('C:\\Users\\someone\\AppData\\Roaming', 'photo_app', 'store'));
    } finally {
      if (prevAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = prevAppData;
    }
  });

  describe('against a throwaway temp folder (never the real fixture folder)', () => {
    let tmpFolder: string;

    beforeEach(() => {
      tmpFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-smoke-fixtures-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpFolder, { recursive: true, force: true });
    });

    it('listImageFiles finds only recognized image extensions, case-insensitively, non-recursively', () => {
      fs.writeFileSync(path.join(tmpFolder, 'a.ORF'), '');
      fs.writeFileSync(path.join(tmpFolder, 'b.jpg'), '');
      fs.writeFileSync(path.join(tmpFolder, 'notes.txt'), '');
      fs.writeFileSync(path.join(tmpFolder, 'sidecar.xmp'), '');
      fs.mkdirSync(path.join(tmpFolder, 'subfolder'));
      fs.writeFileSync(path.join(tmpFolder, 'subfolder', 'c.jpg'), '');

      const found = resetSmokeFixtures.listImageFiles(tmpFolder).map((p: string) => path.basename(p)).sort();

      expect(found).toEqual(['a.ORF', 'b.jpg']);
    });

    it('planDeletions maps every image path to its exact edits: store file, without touching disk', () => {
      const images = [path.join(tmpFolder, 'a.orf'), path.join(tmpFolder, 'b.jpg')];
      const storeDir = path.join(tmpFolder, 'fake-store');

      const plan = resetSmokeFixtures.planDeletions(storeDir, images);

      expect(plan).toHaveLength(2);
      for (const { imagePath, storeFile } of plan) {
        const expectedHash = crypto.createHash('sha1').update(`edits:${imagePath}`).digest('hex');
        expect(storeFile).toBe(path.join(storeDir, `${expectedHash}.json`));
      }
      // planDeletions is pure — it must not create the store dir or any file.
      expect(fs.existsSync(storeDir)).toBe(false);
    });
  });
});
