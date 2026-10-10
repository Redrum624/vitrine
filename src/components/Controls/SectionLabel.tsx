import type { ReactNode } from 'react';

interface SectionLabelProps {
  children: ReactNode;
  className?: string;
}

/** "TONE" → "Tone", "HIGHLIGHT RECOVERY" → "Highlight recovery". Mixed-case text is left alone. */
function toSentenceCase(children: ReactNode): ReactNode {
  if (typeof children !== 'string') return children;
  if (children !== children.toUpperCase() || !/[A-Z]/.test(children)) return children;
  const lower = children.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Safelight section label inside a module: a quiet sentence-case heading
 * (11.5px/600, muted) followed by a hairline. All-caps labels passed by older
 * call sites are rendered in sentence case — shouting caps and accent-coloured
 * headings read as a web page, not a tool.
 */
export function SectionLabel({ children, className = '' }: SectionLabelProps) {
  return (
    <div className={`flex items-center ${className}`} style={{ gap: 8 }}>
      <span
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          color: 'var(--glass-text-muted)',
          whiteSpace: 'nowrap',
        }}
      >
        {toSentenceCase(children)}
      </span>
      <span
        aria-hidden="true"
        style={{
          flex: 1,
          height: 1,
          background: 'var(--vt-line-soft)',
        }}
      />
    </div>
  );
}

export default SectionLabel;
