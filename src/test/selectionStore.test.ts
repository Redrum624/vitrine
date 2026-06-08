import { useAppStore } from '../stores/appStore';

const getState = () => useAppStore.getState();

beforeEach(() => {
  getState().clearSelection();
  getState().endExportProgress();
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe('toggleImageSelection', () => {
  it('adds an id when absent', () => {
    getState().toggleImageSelection('a');
    expect(getState().selectedImageIds).toEqual(['a']);
    expect(getState().selectionAnchorId).toBe('a');
  });

  it('removes an id when already present', () => {
    getState().toggleImageSelection('a');
    getState().toggleImageSelection('a');
    expect(getState().selectedImageIds).toEqual([]);
    expect(getState().selectionAnchorId).toBe('a');
  });

  it('accumulates multiple ids and keeps last as anchor', () => {
    getState().toggleImageSelection('a');
    getState().toggleImageSelection('b');
    expect(getState().selectedImageIds).toEqual(['a', 'b']);
    expect(getState().selectionAnchorId).toBe('b');
  });
});

describe('setSelection', () => {
  it('replaces the selection with the provided ids', () => {
    getState().toggleImageSelection('old');
    getState().setSelection(['x', 'y', 'z']);
    expect(getState().selectedImageIds).toEqual(['x', 'y', 'z']);
  });

  it('defaults anchorId to the last id in the array', () => {
    getState().setSelection(['x', 'y', 'z']);
    expect(getState().selectionAnchorId).toBe('z');
  });

  it('uses explicit anchorId when provided', () => {
    getState().setSelection(['x', 'y', 'z'], 'x');
    expect(getState().selectionAnchorId).toBe('x');
  });

  it('sets anchorId to null when ids is empty (defaulted)', () => {
    getState().setSelection([]);
    expect(getState().selectionAnchorId).toBeNull();
  });

  it('sets anchorId to null when ids is empty (explicit null)', () => {
    getState().setSelection([], null);
    expect(getState().selectionAnchorId).toBeNull();
  });
});

describe('clearSelection', () => {
  it('empties selectedImageIds and resets anchorId to null', () => {
    getState().setSelection(['a', 'b'], 'a');
    getState().clearSelection();
    expect(getState().selectedImageIds).toEqual([]);
    expect(getState().selectionAnchorId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Export progress
// ---------------------------------------------------------------------------

describe('export progress lifecycle', () => {
  it('starts at null', () => {
    expect(getState().exportProgress).toBeNull();
  });

  it('startExportProgress initialises the progress object', () => {
    getState().startExportProgress(5);
    expect(getState().exportProgress).toEqual({
      current: 0,
      total: 5,
      currentName: '',
      cancelRequested: false,
    });
  });

  it('updateExportProgress advances current and currentName', () => {
    getState().startExportProgress(3);
    getState().updateExportProgress(1, 'photo1.jpg');
    expect(getState().exportProgress).toMatchObject({ current: 1, currentName: 'photo1.jpg', total: 3 });
  });

  it('requestExportCancel sets cancelRequested to true', () => {
    getState().startExportProgress(3);
    getState().requestExportCancel();
    expect(getState().exportProgress?.cancelRequested).toBe(true);
  });

  it('endExportProgress resets to null', () => {
    getState().startExportProgress(3);
    getState().endExportProgress();
    expect(getState().exportProgress).toBeNull();
  });
});

describe('export progress no-ops when null', () => {
  it('updateExportProgress is a no-op when exportProgress is null', () => {
    expect(getState().exportProgress).toBeNull();
    getState().updateExportProgress(1, 'file.jpg');
    expect(getState().exportProgress).toBeNull();
  });

  it('requestExportCancel is a no-op when exportProgress is null', () => {
    expect(getState().exportProgress).toBeNull();
    getState().requestExportCancel();
    expect(getState().exportProgress).toBeNull();
  });
});
