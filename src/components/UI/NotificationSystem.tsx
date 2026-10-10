import { useEffect, useRef, useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  duration?: number;
}

interface NotificationSystemProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}

// Semantic icon colours (the only colour in a toast — no stripes or fills).
const ACCENT: Record<Notification['type'], string> = {
  success: '#4cc38a',
  error:   '#f06a6a',
  warning: 'var(--accent)',
  info:    '#8fb4ff',
};

function ToastItem({ notification, onDismiss }: { notification: Notification; onDismiss: (id: string) => void }) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = () => {
    if (exiting) return;
    setExiting(true);
    setTimeout(() => onDismiss(notification.id), 250);
  };

  useEffect(() => {
    if (notification.duration && notification.duration > 0) {
      timerRef.current = setTimeout(dismiss, notification.duration);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const accent = ACCENT[notification.type];

  const icon = (() => {
    const cls = 'w-4 h-4 flex-shrink-0';
    switch (notification.type) {
      case 'success': return <CheckCircle className={cls} style={{ color: accent }} />;
      case 'error':   return <XCircle className={cls} style={{ color: accent }} />;
      case 'warning': return <AlertTriangle className={cls} style={{ color: accent }} />;
      case 'info':    return <Info className={cls} style={{ color: accent }} />;
    }
  })();

  return (
    <div
      className="toast-item glass-chrome"
      role="status"
      style={{
        borderRadius: '8px',
        padding: '10px 10px 10px 12px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        minWidth: '260px',
        maxWidth: '360px',
        animation: exiting ? 'toast-out 200ms ease-in forwards' : 'toast-in 380ms var(--ease-spring) both',
        pointerEvents: 'auto',
      }}
      onMouseEnter={() => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } }}
      onMouseLeave={() => {
        if (notification.duration && notification.duration > 0 && !exiting) {
          timerRef.current = setTimeout(dismiss, 2000);
        }
      }}
    >
      <div style={{ marginTop: '1px' }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--vt-text)', lineHeight: '17px' }}>
          {notification.title}
        </div>
        <div style={{ fontSize: '11.5px', color: 'var(--glass-text-muted)', lineHeight: '16px', marginTop: '2px' }}>
          {notification.message}
        </div>
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="glass-pill-btn"
        style={{
          background: 'none', border: 'none', padding: '3px', borderRadius: 4,
          color: 'var(--glass-text-muted)', flexShrink: 0, display: 'flex',
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
}

export function NotificationSystem({ notifications, onDismiss }: NotificationSystemProps) {
  if (notifications.length === 0) return null;

  return (
    <>
      {/* Keyframes injected once */}
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(10px) scale(0.98); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes toast-out {
          from { opacity: 1; transform: none; }
          to   { opacity: 0; transform: translateY(6px); }
        }
      `}</style>
      <div
        style={{
          position: 'fixed',
          bottom: '44px', // clears the 32px status bar
          right: '16px',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: '8px',
          pointerEvents: 'none',
        }}
      >
        {notifications.map(n => (
          <ToastItem key={n.id} notification={n} onDismiss={onDismiss} />
        ))}
      </div>
    </>
  );
}
