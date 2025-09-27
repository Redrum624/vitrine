export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  duration?: number;
}

export class NotificationServiceClass {
  private notifications: Notification[] = [];
  private listeners: Array<(notifications: Notification[]) => void> = [];

  // Add a notification
  add(notification: Omit<Notification, 'id'>): string {
    const id = `notification_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newNotification: Notification = {
      ...notification,
      id,
      duration: notification.duration ?? 5000 // Default 5 seconds
    };

    this.notifications = [...this.notifications, newNotification];
    this.notifyListeners();
    return id;
  }

  // Remove a notification
  remove(id: string): void {
    this.notifications = this.notifications.filter(n => n.id !== id);
    this.notifyListeners();
  }

  // Clear all notifications
  clear(): void {
    this.notifications = [];
    this.notifyListeners();
  }

  // Subscribe to notifications
  subscribe(listener: (notifications: Notification[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  // Get current notifications
  getNotifications(): Notification[] {
    return [...this.notifications];
  }

  // Convenience methods
  success(title: string, message: string, duration?: number): string {
    return this.add({ type: 'success', title, message, duration });
  }

  error(title: string, message: string, duration?: number): string {
    return this.add({ type: 'error', title, message, duration: duration ?? 8000 }); // Errors stay longer
  }

  warning(title: string, message: string, duration?: number): string {
    return this.add({ type: 'warning', title, message, duration });
  }

  info(title: string, message: string, duration?: number): string {
    return this.add({ type: 'info', title, message, duration });
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener([...this.notifications]));
  }
}

export const notificationService = new NotificationServiceClass();