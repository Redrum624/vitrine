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

const ACCENT: Record<Notification['type'], string> = {
  success: '#22c55e',
  error:   '#ef4444',
  warning: '#eab308',
  info:    '#3b82f6',
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
      className="toast-item"
      style={{
        backgroundColor: 'var(--gray-900)',
        border: '1px solid var(--border)',
        borderRadius: '4px',
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        minWidth: '260px',
        maxWidth: '360px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.45)',
        borderLeft: `3px solid ${accent}`,
        animation: exiting ? 'toast-out 0.25s ease-in forwards' : 'toast-in 0.3s ease-out forwards',
        cursor: 'default',
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
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--white)', lineHeight: '16px' }}>
          {notification.title}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--gray-400)', lineHeight: '15px', marginTop: '2px' }}>
          {notification.message}
        </div>
      </div>
      <button
        onClick={dismiss}
        style={{
          background: 'none', border: 'none', padding: '2px', cursor: 'pointer',
          color: 'var(--gray-500)', flexShrink: 0, display: 'flex',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--white)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--gray-500)'; }}
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
          from { opacity: 0; transform: translateX(40px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes toast-out {
          from { opacity: 1; transform: translateX(0); }
          to   { opacity: 0; transform: translateX(40px); }
        }
      `}</style>
      <div
        style={{
          position: 'fixed',
          bottom: '16px',
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
