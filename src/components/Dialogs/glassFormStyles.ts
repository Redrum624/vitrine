import type { CSSProperties } from 'react';

/**
 * Shared glass-card form-field/box styles used across the ported dialogs
 * (Export/Batch/ImageSize/Preset/Print/Shortcuts). Previously each dialog
 * kept its own copy of these identical `CSSProperties` objects — centralised
 * here so there is one definition to update.
 */

/** Native <input>/<select> restyled with the token palette (RawDecodePanel's
 *  selects were the original precedent). Inputs and selects share the exact
 *  same look, so `selectStyle` is just an alias — no need to keep two copies
 *  of an identical object in sync. */
export const inputStyle: CSSProperties = {
  width: '100%',
  fontSize: 12,
  padding: '6px 8px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,.1)',
  background: 'rgba(255,255,255,.04)',
  color: 'var(--glass-text-label)',
};

export const selectStyle: CSSProperties = inputStyle;

/** Muted read-only panel for a labelled readout (Original Size, Output Size,
 *  batch statistics, ...). `statBoxStyle` is an alias of the same object for
 *  call sites that name it after "stat" rather than "info". */
export const infoBoxStyle: CSSProperties = {
  padding: 12,
  borderRadius: 10,
  background: 'rgba(0,0,0,.3)',
  border: '1px solid var(--glass-border)',
};

export const statBoxStyle: CSSProperties = infoBoxStyle;
