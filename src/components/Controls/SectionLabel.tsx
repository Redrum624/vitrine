import type { ReactNode } from 'react';

interface SectionLabelProps {
  children: ReactNode;
  className?: string;
}

/**
 * Glass · Sectioned module-card section header: 10px/700 uppercase accent
 * text followed by a fading hairline. See the Glass UI design spec
 * ("Module card system" → Section labels) and 4a Dev Handoff.dc.html §4 (Body).
 */
export function SectionLabel({ children, className = '' }: SectionLabelProps) {
  return (
    <div className={`flex items-center ${className}`} style={{ gap: 8 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '1.4px',
          textTransform: 'uppercase',
          color: 'var(--accent)',
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </span>
      <span
        aria-hidden="true"
        style={{
          flex: 1,
          height: 1,
          background: 'linear-gradient(to right, rgba(255,255,255,.12), transparent)',
        }}
      />
    </div>
  );
}

export default SectionLabel;
