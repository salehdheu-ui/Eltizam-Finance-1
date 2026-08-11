import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, BellOff, BellRing, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  disablePushNotifications,
  enablePushNotifications,
  hasLocalSubscription,
  notificationPermission,
  supportsPush,
} from "@/lib/pwa";

type PushConfig = {
  configured: boolean;
  publicKey: string | null;
  deviceCount: number;
  preferences: {
    bankImports: boolean;
    bankReviews: boolean;
    balanceGaps: boolean;
  };
};

const TOPICS: Array<{ key: keyof PushConfig["preferences"]; title: string; description: string }> = [
  { key: "bankImports", title: "الحركات الجديدة", description: "عند إضافة خصم أو إيداع من رسائل البنك" },
  { key: "bankReviews", title: "ما ينتظر مراجعتك", description: "عند وجود رسالة بنكية تحتاج تأكيدك" },
  { key: "balanceGaps", title: "فجوات الرصيد", description: "عند تغيّر رصيد البنك دون رسالة تشرح السبب" },
];

export function NotificationsCard() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<PushConfig>({ queryKey: ["/api/push/config"] });
  const [subscribedHere, setSubscribedHere] = useState(false);
  const [isWorking, setIsWorking] = useState(false);

  // Whether *this* device is subscribed is a browser fact, not a server one: the
  // account may well be receiving notifications on a phone while this laptop is
  // not, and showing the server's device count as if it meant "on" would be wrong.
  useEffect(() => {
    void hasLocalSubscription().then(setSubscribedHere);
  }, [data?.deviceCount]);

  const savePreferences = useMutation({
    mutationFn: (input: Partial<PushConfig["preferences"]>) => apiRequest("PATCH", "/api/push/preferences", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/push/config"] }),
    onError: (error: Error) => toast({ title: "تعذر حفظ التفضيل", description: error.message, variant: "destructive" }),
  });

  const sendTest = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/push/test");
      return response.json() as Promise<{ message: string }>;
    },
    onSuccess: (result) => toast({ title: "تم الإرسال", description: result.message }),
    onError: (error: Error) => toast({ title: "تعذر الإرسال", description: error.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <Card className="flex items-center justify-center p-6 shadow-sm">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </Card>
    );
  }

  const permission = notificationPermission();

  // Offering a switch that cannot work is worse than explaining why it is absent,
  // so each blocked case says what it is and who can unblock it.
  if (!supportsPush()) {
    return (
      <Card className="p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <BellOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <h3 className="font-bold">الإشعارات غير مدعومة</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              هذا المتصفح لا يدعم الإشعارات. على الآيفون، أضف التطبيق إلى الشاشة الرئيسية من زر المشاركة ثم افتحه من هناك لتفعيلها.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (!data?.configured) {
    return (
      <Card className="p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <BellOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <h3 className="font-bold">الإشعارات غير مفعّلة على الخادم</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              تحتاج إدارة المنصة إلى ضبط مفاتيح الإشعارات (VAPID) قبل أن تتمكن من تفعيلها.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const handleToggle = async (next: boolean) => {
    setIsWorking(true);
    try {
      if (!next) {
        await disablePushNotifications();
        setSubscribedHere(false);
        await queryClient.invalidateQueries({ queryKey: ["/api/push/config"] });
        toast({ title: "تم إيقاف الإشعارات على هذا الجهاز" });
        return;
      }

      const result = await enablePushNotifications(data.publicKey!);
      if (result.state === "enabled") {
        setSubscribedHere(true);
        await queryClient.invalidateQueries({ queryKey: ["/api/push/config"] });
        toast({ title: "تم تفعيل الإشعارات", description: "سنخبرك بالحركات الجديدة فور وصولها." });
      } else if (result.state === "denied") {
        toast({
          title: "تم رفض الإذن",
          description: "الإشعارات محجوبة لهذا الموقع. فعّلها من إعدادات المتصفح ثم أعد المحاولة.",
          variant: "destructive",
        });
      } else if (result.state === "unsupported") {
        toast({ title: "غير مدعوم في هذا المتصفح", variant: "destructive" });
      } else {
        toast({ title: "تعذر التفعيل", description: result.message, variant: "destructive" });
      }
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <Card className="overflow-hidden shadow-sm">
      <div className="flex items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${subscribedHere ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
            {subscribedHere ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <h3 className="font-bold">الإشعارات</h3>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {subscribedHere
                ? "مفعّلة على هذا الجهاز"
                : permission === "denied"
                  ? "محجوبة من إعدادات المتصفح"
                  : "فعّلها لتصلك الحركات فور قراءتها"}
            </p>
          </div>
        </div>
        {isWorking
          ? <Loader2 className="h-5 w-5 animate-spin text-primary" />
          : <Switch checked={subscribedHere} onCheckedChange={handleToggle} disabled={permission === "denied"} aria-label="تفعيل الإشعارات" />}
      </div>

      {subscribedHere ? (
        <>
          <div className="border-t">
            {TOPICS.map((topic) => (
              <div key={topic.key} className="flex items-center justify-between gap-3 border-b p-4 last:border-b-0">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{topic.title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{topic.description}</p>
                </div>
                <Switch
                  checked={data.preferences[topic.key]}
                  onCheckedChange={(checked) => savePreferences.mutate({ [topic.key]: checked })}
                  disabled={savePreferences.isPending}
                  aria-label={topic.title}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 bg-muted/40 p-4">
            <p className="text-xs text-muted-foreground">
              {data.deviceCount === 1 ? "جهاز واحد مشترك" : `${data.deviceCount} أجهزة مشتركة`}
            </p>
            <Button variant="outline" size="sm" onClick={() => sendTest.mutate()} disabled={sendTest.isPending}>
              {sendTest.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              إشعار تجريبي
            </Button>
          </div>
        </>
      ) : null}
    </Card>
  );
}
