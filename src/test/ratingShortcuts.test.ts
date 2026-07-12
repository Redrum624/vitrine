/**
 * Unit tests for the number-key (1-5 / 0) star-rating shortcuts.
 *
 * `createRatingShortcuts(onRate)` builds the KeyboardShortcut list; 1-5 set
 * that rating, 0 clears. They run through KeyboardShortcutsService, so the
 * existing "ignore while typing in a field" guard must also apply.
 */
import {
  KeyboardShortcutsService,
  createRatingShortcuts,
} from '../services/KeyboardShortcutsService';

describe('createRatingShortcuts', () => {
  it('creates a shortcut for each of keys 0 through 5', () => {
    const shortcuts = createRatingShortcuts(() => {});
    expect(shortcuts.map((s) => s.key).sort()).toEqual(['0', '1', '2', '3', '4', '5']);
  });

  it('invokes onRate with the pressed digit (1-5 set, 0 clears)', () => {
    const onRate = jest.fn();
    const shortcuts = createRatingShortcuts(onRate);

    shortcuts.find((s) => s.key === '4')!.action();
    expect(onRate).toHaveBeenLastCalledWith(4);

    shortcuts.find((s) => s.key === '0')!.action();
    expect(onRate).toHaveBeenLastCalledWith(0);
  });
});

describe('rating shortcuts via KeyboardShortcutsService', () => {
  let service: KeyboardShortcutsService;
  let onRate: jest.Mock;

  beforeEach(() => {
    onRate = jest.fn();
    service = new KeyboardShortcutsService();
    createRatingShortcuts(onRate).forEach((s) => service.register(s));
  });

  afterEach(() => {
    service.destroy();
  });

  it('fires the rating action when a number key is pressed', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    expect(onRate).toHaveBeenCalledWith(3);
  });

  it('does not fire while typing in a text input', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    expect(onRate).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('still fires after destroy() + re-register (listener re-attaches)', () => {
    // Reproduces the "shortcuts dead after the first image/tool change" bug: the
    // App effect calls destroy() on cleanup (removing the listener) then re-registers.
    service.destroy();
    createRatingShortcuts(onRate).forEach((s) => service.register(s));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }));
    expect(onRate).toHaveBeenCalledWith(4);
  });
});
