import { useEffect, useRef } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  duration?: number; // Auto-dismiss after duration (ms), 0 = no auto-dismiss
}

interface NotificationSystemProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}


export function NotificationSystem({ notifications, onDismiss }: NotificationSystemProps) {
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Handle auto-dismiss timers
  useEffect(() => {
    const currentTimers = timersRef.current;

    notifications.forEach(notification => {
      // Only set timer if not already set and has a duration
      if (notification.duration && notification.duration > 0 && !currentTimers.has(notification.id)) {
        const timer = setTimeout(() => {
          onDismiss(notification.id);
          currentTimers.delete(notification.id);
        }, notification.duration);
        currentTimers.set(notification.id, timer);
      }
    });

    // Clean up timers for dismissed notifications
    currentTimers.forEach((timer, id) => {
      if (!notifications.some(n => n.id === id)) {
        clearTimeout(timer);
        currentTimers.delete(id);
      }
    });

    return () => {
      currentTimers.forEach(timer => clearTimeout(timer));
    };
  }, [notifications, onDismiss]);

  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-400" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-400" />;
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-yellow-400" />;
      case 'info':
        return <Info className="w-5 h-5 text-blue-400" />;
      default:
        return <Info className="w-5 h-5 text-blue-400" />;
    }
  };

  const getStyles = (type: Notification['type']) => {
    const baseStyles = "rounded-lg shadow-lg border-l-4 transition-all duration-300 ease-in-out";

    switch (type) {
      case 'success':
        return `${baseStyles} bg-green-50 border-green-400 text-green-800`;
      case 'error':
        return `${baseStyles} bg-red-50 border-red-400 text-red-800`;
      case 'warning':
        return `${baseStyles} bg-yellow-50 border-yellow-400 text-yellow-800`;
      case 'info':
        return `${baseStyles} bg-blue-50 border-blue-400 text-blue-800`;
      default:
        return `${baseStyles} bg-gray-50 border-gray-400 text-gray-800`;
    }
  };

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-50 space-y-3 max-w-sm">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`${getStyles(notification.type)} p-4 animate-slide-in-right`}
        >
          <div className="flex items-start">
            <div className="flex-shrink-0 mr-3">
              {getIcon(notification.type)}
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold mb-1">{notification.title}</h4>
              <p className="text-sm">{notification.message}</p>
            </div>
            <button
              onClick={() => onDismiss(notification.id)}
              className="ml-3 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

