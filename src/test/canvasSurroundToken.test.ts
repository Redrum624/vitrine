/**
 * The 2D-canvas fills (CPU render path, empty placeholder, before/after original) can't read
 * CSS variables, so they use CANVAS_SURROUND. It must stay equal to --vt-canvas, or a zoomed-out
 * photo sits inside a visibly different rectangle on the surround.
 */
import * as fs from 'fs';
import * as path from 'path';
import { CANVAS_SURROUND } from '../layout/photoRegion';

describe('CANVAS_SURROUND', () => {
  it('equals the --vt-canvas token', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'index.css'), 'utf8');
    const token = /--vt-canvas:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1];
    expect(token?.toLowerCase()).toBe(CANVAS_SURROUND.toLowerCase());
  });
});
