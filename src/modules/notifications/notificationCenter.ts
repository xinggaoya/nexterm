import type { NotificationApi, NotificationType } from "naive-ui";

const DEFAULT_DURATION = 4500;
const ERROR_DURATION = 6500;

let notificationApi: Pick<NotificationApi, "create"> | null = null;

export function bindNotificationApi(api: Pick<NotificationApi, "create"> | null) {
  notificationApi = api;
}

export function notifySuccess(title: string, content?: string | null) {
  notify("success", title, content);
}

export function notifyInfo(title: string, content?: string | null) {
  notify("info", title, content);
}

export function notifyError(title: string, error: unknown) {
  notify("error", title, normalizeNotificationError(error), ERROR_DURATION);
}

function notify(
  type: NotificationType,
  title: string,
  content?: string | null,
  duration = DEFAULT_DURATION,
) {
  if (!notificationApi) {
    if (type === "error") console.error(title, content ?? "");
    return;
  }
  notificationApi.create({
    type,
    title,
    content: content || undefined,
    duration,
    keepAliveOnHover: true,
  });
}

function normalizeNotificationError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown error";
}
