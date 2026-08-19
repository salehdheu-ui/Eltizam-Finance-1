import { useState } from "react";
import { Bell, BellRing, CheckCheck, Loader2, Settings } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useInAppNotifications,
  useMarkAllInAppNotificationsRead,
  useMarkInAppNotificationRead,
  type InAppNotification,
} from "@/lib/hooks";
import { cn } from "@/lib/utils";

function formatNotificationTime(timestamp: number) {
  const elapsedSeconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (elapsedSeconds < 60) return "الآن";
  if (elapsedSeconds < 3600) return `منذ ${Math.floor(elapsedSeconds / 60)} دقيقة`;
  if (elapsedSeconds < 86400) return `منذ ${Math.floor(elapsedSeconds / 3600)} ساعة`;
  if (elapsedSeconds < 604800) return `منذ ${Math.floor(elapsedSeconds / 86400)} يوم`;

  return new Intl.DateTimeFormat("ar-OM", { day: "numeric", month: "short" })
    .format(new Date(timestamp * 1000));
}

export function NotificationCenter() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const { data, isLoading, refetch } = useInAppNotifications();
  const markRead = useMarkInAppNotificationRead();
  const markAllRead = useMarkAllInAppNotificationsRead();
  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) void refetch();
  };

  const openNotification = (notification: InAppNotification) => {
    if (!notification.readAt) markRead.mutate(notification.id);
    setOpen(false);
    setLocation(notification.url || "/");
  };

  const openSettings = () => {
    setOpen(false);
    setLocation("/settings");
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative h-10 w-10 rounded-full"
          aria-label={unreadCount > 0 ? `الإشعارات، ${unreadCount} غير مقروء` : "الإشعارات"}
        >
          {unreadCount > 0 ? <BellRing className="h-5 w-5 text-primary" /> : <Bell className="h-5 w-5" />}
          {unreadCount > 0 ? (
            <span className="absolute -left-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground ring-2 ring-background">
              {unreadCount > 99 ? "+99" : unreadCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" sideOffset={8} className="w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden p-0" dir="rtl">
        <div className="flex items-center justify-between gap-3 border-b p-4">
          <div>
            <h2 className="font-bold">الإشعارات</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} إشعار غير مقروء` : "اطلعت على كل الإشعارات"}
            </p>
          </div>
          {unreadCount > 0 ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
              {markAllRead.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
              قراءة الكل
            </Button>
          ) : null}
        </div>

        <ScrollArea className="h-[min(22rem,55vh)]">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : notifications.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <Bell className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-3 font-medium">لا توجد إشعارات بعد</p>
              <p className="mt-1 text-xs text-muted-foreground">ستظهر هنا المهام المسندة والتذكيرات المهمة.</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => openNotification(notification)}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-3 text-right transition-colors hover:bg-muted/60",
                    !notification.readAt && "bg-primary/5",
                  )}
                >
                  <span className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", notification.readAt ? "bg-transparent" : "bg-primary")} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", !notification.readAt && "font-bold")}>{notification.title}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">{notification.body}</span>
                    <span className="mt-1.5 block text-[11px] text-muted-foreground/80">{formatNotificationTime(notification.createdAt)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="border-t bg-muted/20 p-2">
          <Button type="button" variant="ghost" size="sm" className="w-full justify-center" onClick={openSettings}>
            <Settings className="h-4 w-4" />
            تفعيل إشعارات الهاتف من الإعدادات
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
