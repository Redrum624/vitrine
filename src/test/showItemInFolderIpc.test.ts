/**
 * "Show in Explorer" IPC plumbing (Task Q5, P11 follow-up): electron/main.cjs
 * requires('electron') at module scope, which isn't available under Jest — same
 * constraint documented in mainRawFormatsConsolidation.test.ts — so this inspects
 * main.cjs's, preload.cjs's, and types/electron.ts's source text directly rather
 * than requiring the modules.
 */
import fs from 'fs';
import path from 'path';

const mainSource = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'main.cjs'), 'utf8');
const preloadSource = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'preload.cjs'), 'utf8');
const typesSource = fs.readFileSync(path.join(__dirname, '..', 'types', 'electron.ts'), 'utf8');

describe('electron/main.cjs — show-item-in-folder handler', () => {
  it('registers exactly one show-item-in-folder handler', () => {
    const matches = mainSource.match(/ipcMain\.handle\('show-item-in-folder'/g) || [];
    expect(matches).toHaveLength(1);
  });

  it('validates the incoming path is a non-empty string before calling shell.showItemInFolder', () => {
    const handlerIndex = mainSource.indexOf("ipcMain.handle('show-item-in-folder'");
    expect(handlerIndex).toBeGreaterThan(-1);
    const nextHandlerIndex = mainSource.indexOf('ipcMain.handle(', handlerIndex + 1);
    const handlerBody = mainSource.slice(handlerIndex, nextHandlerIndex === -1 ? undefined : nextHandlerIndex);

    expect(handlerBody).toMatch(/typeof filePath\s*!==\s*'string'/);
    expect(handlerBody).toMatch(/shell\.showItemInFolder\(/);
  });
});

describe('electron/preload.cjs — showItemInFolder bridge', () => {
  it('exposes showItemInFolder mapped to the show-item-in-folder channel', () => {
    expect(preloadSource).toMatch(/showItemInFolder:\s*\(filePath\)\s*=>\s*ipcRenderer\.invoke\('show-item-in-folder',\s*filePath\)/);
  });
});

describe('src/types/electron.ts — ElectronAPI.showItemInFolder', () => {
  it('declares showItemInFolder on the ElectronAPI interface', () => {
    expect(typesSource).toMatch(/showItemInFolder:\s*\(filePath:\s*string\)\s*=>\s*Promise</);
  });
});
