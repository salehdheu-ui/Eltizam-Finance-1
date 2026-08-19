import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Bell, BellOff, Loader2, Send } from "lucide-react";

type Preferences = {
  emailEnabled: boolean;
  pushEnabled: boolean;
  telegramEnabled: boolean;
  telegramChatId: string | null;
  whatsappEnabled: boolean;
  whatsappNumber: string | null;
  webhookUrl: string | null;
  weeklySummary: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  pushPublicKey: string | null;
  channels: { email: boolean; push: boolean; telegram: boolean; whatsapp: boolean };
};

/** The push API needs the VAPID key as raw bytes, not the base64url the server stores. */
function urlBase64ToUint8Array(base64: string) {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const normalized = padded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

export default function NotificationSettings() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Preferences>({ queryKey: ["/api/notifications/preferences"] });
  const [pushState, setPushState] = useState<"unknown" | "on" | "off" | "unsupported">("unknown");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushState("unsupported");
      return;
    }
    navigator.serviceWorker.getRegistration().then(async (registration) => {
      const subscription = await registration?.pushManager.getSubscription();
      setPushState(subscription ? "on" : "off");
    });
  }, []);

  const save = useMutation({
    mutationFn: (patch: Partial<Preferences>) => apiRequest("PATCH", "/api/notifications/preferences", patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/notifications/preferences"] }),
    onError: (error: Error) => toast({ title: "تعذر الحفظ", description: error.message, variant: "destructive" }),
  });

  const sendTest = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/notifications/test");
      return response.json() as Promise<{ inApp: boolean; sent: string[]; skipped: string[] }>;
    },
    onSuccess: (result) => {
      toast({
        title: result.sent.length
          ? `أُرسلت عبر: ${result.sent.join("، ")}`
          : result.inApp ? "وصل الإشعار داخل النظام" : "لم تُرسل أي قناة",
        description: result.skipped.length ? result.skipped.join(" · ") : undefined,
        variant: result.sent.length || result.inApp ? undefined : "destructive",
      });
    },
    onError: (error: Error) => toast({ title: "تعذر الإرسال", description: error.message, variant: "destructive" }),
  });

  const enablePush = async () => {
    if (!data?.pushPublicKey) {
      toast({ title: "الإشعارات غير مهيّأة", description: "مفاتيح Push غير مضبوطة على الخادم. يضبطها مدير النظام من صفحة الإدارة › قنوات الإشعارات.", variant: "destructive" });
      return;
    }

    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast({ title: "لم يُمنح الإذن", description: "فعّل الإشعارات لهذا الموقع من إعدادات المتصفح.", variant: "destructive" });
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.pushPublicKey),
      });

      await apiRequest("POST", "/api/notifications/push/subscribe", subscription.toJSON());
      await apiRequest("PATCH", "/api/notifications/preferences", { pushEnabled: true });
      await queryClient.invalidateQueries({ queryKey: ["/api/notifications/preferences"] });
      setPushState("on");
      toast({ title: "فُعّلت الإشعارات على هذا الجهاز" });
    } catch (error) {
      toast({ title: "تعذر التفعيل", description: error instanceof Error ? error.message : "حاول مرة أخرى", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const disablePush = async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await apiRequest("POST", "/api/notifications/push/unsubscribe", { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      await apiRequest("PATCH", "/api/notifications/preferences", { pushEnabled: false });
      await queryClient.invalidateQueries({ queryKey: ["/api/notifications/preferences"] });
      setPushState("off");
      toast({ title: "أُوقفت الإشعارات على هذا الجهاز" });
    } finally {
      setBusy(false);
    }
  };

  if (isLoading || !data) {
    return <Card className="p-4"><div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div></Card>;
  }

  const row = (label: string, hint: string, checked: boolean, onChange: (value: boolean) => void, available = true) => (
    <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
      <div className="min-w-0">
        <p className="font-semibold">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground">{available ? hint : "غير مهيّأ من إدارة المنصة"}</p>
      </div>
      <Switch checked={checked && available} disabled={!available || save.isPending} onCheckedChange={onChange} />
    </div>
  );

  return (
    <Card className="space-y-4 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">التذكيرات والإشعارات</h2>
          <p className="text-sm text-muted-foreground">اختر أين تصلك تذكيرات التزاماتك.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => sendTest.mutate()} disabled={sendTest.isPending}>
          {sendTest.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          تجربة
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
          <div className="min-w-0">
            <p className="font-semibold">إشعارات الجهاز</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {pushState === "unsupported" ? "متصفحك لا يدعم الإشعارات" : "تصلك حتى والتطبيق مغلق"}
            </p>
          </div>
          {pushState === "on" ? (
            <Button variant="outline" size="sm" onClick={disablePush} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellOff className="h-4 w-4" />} إيقاف
            </Button>
          ) : (
            <Button size="sm" onClick={enablePush} disabled={busy || pushState === "unsupported" || !data.channels.push}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />} تفعيل
            </Button>
          )}
        </div>

        {row("البريد الإلكتروني", "تذكير على بريدك المسجّل", data.emailEnabled, (value) => save.mutate({ emailEnabled: value }), data.channels.email)}
        {row("Telegram", "رسالة فورية على تيليجرام", data.telegramEnabled, (value) => save.mutate({ telegramEnabled: value }), data.channels.telegram)}
        {row("WhatsApp", "رسالة على واتساب", data.whatsappEnabled, (value) => save.mutate({ whatsappEnabled: value }), data.channels.whatsapp)}
        {row("الملخص الأسبوعي", "خلاصة أسبوعية لالتزاماتك وصرفك", data.weeklySummary, (value) => save.mutate({ weeklySummary: value }))}
      </div>

      {data.channels.telegram && data.telegramEnabled ? (
        <div className="space-y-2">
          <Label htmlFor="telegram-chat">معرّف محادثة Telegram</Label>
          <Input
            id="telegram-chat"
            defaultValue={data.telegramChatId || ""}
            placeholder="راسل البوت بكلمة /start ثم الصق الرقم"
            dir="ltr"
            onBlur={(event) => save.mutate({ telegramChatId: event.target.value.trim() || null })}
          />
        </div>
      ) : null}

      {data.channels.whatsapp && data.whatsappEnabled ? (
        <div className="space-y-2">
          <Label htmlFor="whatsapp-number">رقم WhatsApp</Label>
          <Input
            id="whatsapp-number"
            defaultValue={data.whatsappNumber || ""}
            placeholder="968XXXXXXXX"
            dir="ltr"
            onBlur={(event) => save.mutate({ whatsappNumber: event.target.value.trim() || null })}
          />
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="webhook-url">Webhook (لـ n8n أو أنظمتك)</Label>
        <Input
          id="webhook-url"
          defaultValue={data.webhookUrl || ""}
          placeholder="https://n8n.example.com/webhook/eltizam"
          dir="ltr"
          onBlur={(event) => save.mutate({ webhookUrl: event.target.value.trim() })}
        />
        <p className="text-xs text-muted-foreground">نرسل لكل تذكير طلب POST فيه العنوان والنص ومفتاح منع التكرار.</p>
      </div>

      <div className="space-y-2 rounded-xl bg-muted/40 p-3">
        <p className="text-sm font-semibold">ساعات الهدوء</p>
        <div className="flex items-center gap-2">
          <Input
            type="number" min={0} max={23} className="w-20" dir="ltr"
            defaultValue={data.quietHoursStart ?? ""}
            placeholder="22"
            onBlur={(event) => save.mutate({ quietHoursStart: event.target.value === "" ? null : Number(event.target.value) })}
          />
          <span className="text-sm text-muted-foreground">إلى</span>
          <Input
            type="number" min={0} max={23} className="w-20" dir="ltr"
            defaultValue={data.quietHoursEnd ?? ""}
            placeholder="7"
            onBlur={(event) => save.mutate({ quietHoursEnd: event.target.value === "" ? null : Number(event.target.value) })}
          />
        </div>
        <p className="text-xs text-muted-foreground">لا نزعجك خلالها، عدا التصعيد للالتزامات المتأخرة.</p>
      </div>
    </Card>
  );
}
