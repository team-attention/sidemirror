export interface INotificationPort {
    showInfo(message: string): void;
    showWarning(message: string): void;
    showError(message: string): void;
}
