import { useState, useEffect } from 'react';
import { notificationService, Notification } from '../services/NotificationService';

export function useNotifications() {
  // Initialize with current notifications
  const [notifications, setNotifications] = useState<Notification[]>(
    () => notificationService.getNotifications()
  );

  useEffect(() => {
    // Subscribe to future updates
    const unsubscribe = notificationService.subscribe(setNotifications);
    return unsubscribe;
  }, []);

  return {
    notifications,
    add: notificationService.add.bind(notificationService),
    remove: notificationService.remove.bind(notificationService),
    clear: notificationService.clear.bind(notificationService),
    success: notificationService.success.bind(notificationService),
    error: notificationService.error.bind(notificationService),
    warning: notificationService.warning.bind(notificationService),
    info: notificationService.info.bind(notificationService),
  };
}