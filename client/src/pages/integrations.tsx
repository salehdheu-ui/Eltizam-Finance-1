import { useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { BellRing, Bot, CalendarDays, CheckCircle2, FileText, Link2, Loader2, Mail, MessageCircle, Plus, Send, Trash2, Upload, Webhook } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import {
  useCommitments,
  useCreateIntegrationWebhook,
  useDeleteIntegrationDocument,
  useDeleteIntegrationWebhook,
  useIntegrations,
  useSyncIntegrationCalendar,
  useTestIntegrationNotification,
  useTestIntegrationWebhook,
  useToggleIntegrationWebhook,
  useUpdateIntegrationNotifications,
} from "@/lib/hooks";

function errorMessage(error: unknown) {
  return error instanceof ApiError || error instanceof Error ? error.message : "تعذر إتمام العملية";
}

function publicKeyBytes(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw.split("").map((character) => character.charCodeAt(0)));
}

function ProviderStatus({ connected, label }: { connected: boolean; label: string }) {
  return (
    <span className={connected ? "inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700" : "inline-flex rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"}>
      {connected && <CheckCircle2 className="h-3.5 w-3.5" />}{connected ? "متصل" : label}
    </span>
  );
}

export default function Integrations() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data, isLoading } = useIntegrations();
  const { data: commitments = [] } = useCommitments();
  const updateSettings = useUpdateIntegrationNotifications();
  const testNotification = useTestIntegrationNotification();
  const syncCalendar = useSyncIntegrationCalendar();
  const createWebhook = useCreateIntegrationWebhook();
  const toggleWebhook = useToggleIntegrationWebhook();
  const testWebhook = useTestIntegrationWebhook();
  const deleteWebhook = useDeleteIntegrationWebhook();
  const deleteDocument = useDeleteIntegrationDocument();
  const fileInput = useRef<HTMLInputElement>(null);
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [documentKind, setDocumentKind] = useState("contract");
  const [documentCommitmentId, setDocumentCommitmentId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [webhookName, setWebhookName] = useState("n8n");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [signingSecret, setSigningSecret] = useState("");

  const accounts = useMemo(() => new Map(data?.accounts.map((item) => [item.provider, item]) || []), [data?.accounts]);
  const settings = data?.settings;

  const saveSetting = async (values: Record<string, unknown>, success = "تم حفظ الإعداد") => {
    try {
      await updateSettings.mutateAsync(values);
      toast({ title: success });
    } catch (error) {
      toast({ title: "تعذر الحفظ", description: errorMessage(error), variant: "destructive" });
    }
  };

  const sendTest = async (channel: "email" | "push" | "whatsapp" | "telegram") => {
    try {
      await testNotification.mutateAsync(channel);
      toast({ title: "تم إرسال رسالة تجريبية" });
    } catch (error) {
      toast({ title: "تعذر الإرسال", description: errorMessage(error), variant: "destructive" });
    }
  };

  const enablePush = async () => {
    try {
      if (!data?.providers.push.publicKey) throw new Error("Push Notifications غير مهيأة من إدارة المنصة");
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("هذا المتصفح لا يدعم Push Notifications");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("اسمح بالإشعارات من إعدادات المتصفح");
      const registration = await navigator.serviceWorker.register("/push-sw.js");
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyBytes(data.providers.push.publicKey) });
      await apiRequest("POST", "/api/integrations/push/subscribe", subscription.toJSON());
      await queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      toast({ title: "تم تفعيل إشعارات هذا الجهاز" });
    } catch (error) {
      toast({ title: "تعذر تفعيل Push", description: errorMessage(error), variant: "destructive" });
    }
  };

  const disablePush = async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration("/push-sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await apiRequest("DELETE", "/api/integrations/push/subscribe", { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      await saveSetting({ pushEnabled: false }, "تم إيقاف Push Notifications");
    } catch (error) {
      toast({ title: "تعذر الإيقاف", description: errorMessage(error), variant: "destructive" });
    }
  };

  const runCalendarSync = async (provider: "google" | "microsoft") => {
    try {
      const result = await syncCalendar.mutateAsync(provider);
      toast({ title: "اكتملت المزامنة", description: `تمت مزامنة ${result.synced} التزام` });
    } catch (error) {
      toast({ title: "تعذرت المزامنة", description: errorMessage(error), variant: "destructive" });
    }
  };

  const uploadDocument = async () => {
    const file = fileInput.current?.files?.[0];
    if (!file) return toast({ title: "اختر ملفًا أولاً", variant: "destructive" });
    const form = new FormData();
    form.append("file", file);
    form.append("kind", documentKind);
    if (documentCommitmentId) form.append("commitmentId", documentCommitmentId);
    setUploading(true);
    try {
      const response = await fetch("/api/integrations/documents", { method: "POST", body: form, credentials: "include" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({ message: "تعذر رفع الملف" }));
        throw new Error(result.message);
      }
      if (fileInput.current) fileInput.current.value = "";
      await queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      toast({ title: "تم حفظ المستند" });
    } catch (error) {
      toast({ title: "تعذر رفع الملف", description: errorMessage(error), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const addWebhook = async () => {
    try {
      const result = await createWebhook.mutateAsync({ name: webhookName, url: webhookUrl, events: ["reminder", "escalated", "completed"] });
      setSigningSecret(result.signingSecret);
      setWebhookUrl("");
      toast({ title: "تم إنشاء Webhook", description: "انسخ مفتاح التوقيع المعروض الآن؛ لن يظهر مرة أخرى." });
    } catch (error) {
      toast({ title: "تعذر إنشاء Webhook", description: errorMessage(error), variant: "destructive" });
    }
  };

  if (isLoading || !data || !settings) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const channelRows = [
    { key: "email" as const, icon: Mail, title: "البريد الإلكتروني", description: "تذكيرات على بريد حسابك", configured: data.providers.email.configured, enabled: settings.emailEnabled },
    { key: "push" as const, icon: BellRing, title: "Push Notifications", description: "تنبيه فوري حتى عند إغلاق المنصة", configured: data.providers.push.configured, enabled: settings.pushEnabled && data.providers.push.subscriptions > 0 },
    { key: "whatsapp" as const, icon: MessageCircle, title: "WhatsApp", description: "تذكير مع رابط الالتزام", configured: data.providers.whatsapp.configured, enabled: settings.whatsappEnabled },
    { key: "telegram" as const, icon: Send, title: "Telegram", description: "قناة اختيارية عبر بوت المنصة", configured: data.providers.telegram.configured, enabled: settings.telegramEnabled },
  ];

  return (
    <div className="space-y-6 p-4 pb-28 sm:p-6 xl:p-8" dir="rtl">
      <header>
        <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Link2 className="h-6 w-6" /></div>
        <h1 className="text-2xl font-bold">التكاملات</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">اربط ما تحتاجه فقط. كل اتصال وإعداد ومستند محفوظ داخل حسابك ولا يظهر لمستخدم آخر.</p>
      </header>

      <Card className="overflow-hidden">
        <div className="border-b p-4"><h2 className="font-bold">قنوات التذكير</h2><p className="mt-1 text-sm text-muted-foreground">فعّل القناة بضغطة واحدة، ويمكنك اختبارها فورًا.</p></div>
        <div className="divide-y">
          {channelRows.map((channel) => (
            <div key={channel.key} className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted"><channel.icon className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{channel.title}</h3><ProviderStatus connected={channel.configured} label="بانتظار تهيئة الإدارة" /></div><p className="text-sm text-muted-foreground">{channel.description}</p></div>
                <Switch checked={channel.enabled} disabled={!channel.configured || updateSettings.isPending} onCheckedChange={(checked) => {
                  if (channel.key === "push") return checked ? enablePush() : disablePush();
                  saveSetting({ [`${channel.key}Enabled`]: checked });
                }} />
              </div>
              {channel.key === "whatsapp" && <div className="mt-3 flex flex-col gap-2 sm:flex-row"><Input dir="ltr" placeholder="+968 9xxxxxxx" value={whatsappNumber || settings.whatsappNumber || ""} onChange={(event) => setWhatsappNumber(event.target.value)} /><Button variant="outline" onClick={() => saveSetting({ whatsappNumber: whatsappNumber || settings.whatsappNumber })}>حفظ الرقم</Button><Button variant="ghost" onClick={() => sendTest("whatsapp")}>اختبار</Button></div>}
              {channel.key === "telegram" && <div className="mt-3 flex flex-col gap-2 sm:flex-row"><Input dir="ltr" placeholder="Chat ID" value={telegramChatId || settings.telegramChatId || ""} onChange={(event) => setTelegramChatId(event.target.value)} /><Button variant="outline" onClick={() => saveSetting({ telegramChatId: telegramChatId || settings.telegramChatId })}>حفظ الحساب</Button><Button variant="ghost" onClick={() => sendTest("telegram")}>اختبار</Button></div>}
              {(channel.key === "email" || channel.key === "push") && channel.enabled && <Button className="mt-3" size="sm" variant="ghost" onClick={() => sendTest(channel.key)}>إرسال تجربة</Button>}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-4">
          <div className="mb-4 flex items-start gap-3"><div className="rounded-xl bg-blue-50 p-2 text-blue-600"><CalendarDays className="h-5 w-5" /></div><div><h2 className="font-bold">Google وOutlook Calendar</h2><p className="text-sm text-muted-foreground">حوّل مواعيد التزاماتك إلى أحداث تقويم.</p></div></div>
          <div className="space-y-3">
            {(["google", "microsoft"] as const).map((provider) => {
              const account = accounts.get(provider);
              return <div key={provider} className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="font-semibold">{provider === "google" ? "Google Calendar" : "Outlook Calendar"}</p><p className="truncate text-xs text-muted-foreground">{account?.email || "غير مربوط"}</p></div>{account ? <Button size="sm" onClick={() => runCalendarSync(provider)} disabled={syncCalendar.isPending}>{syncCalendar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "مزامنة الآن"}</Button> : <Button size="sm" variant="outline" onClick={() => setLocation("/bank-inbox")}>ربط الحساب</Button>}</div>;
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">إذا كان الحساب مربوطًا قبل إضافة التقويم، أعد ربطه مرة واحدة لمنح صلاحية Calendar.</p>
        </Card>

        <Card className="p-4">
          <div className="mb-4 flex items-start gap-3"><div className="rounded-xl bg-amber-50 p-2 text-amber-600"><Upload className="h-5 w-5" /></div><div><h2 className="font-bold">العقود والفواتير</h2><p className="text-sm text-muted-foreground">PDF أو صورة أو Word، حتى 10MB.</p></div></div>
          <div className="space-y-3">
            <Input ref={fileInput} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" />
            <div className="grid gap-2 sm:grid-cols-2">
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={documentKind} onChange={(event) => setDocumentKind(event.target.value)}><option value="contract">عقد</option><option value="invoice">فاتورة</option><option value="receipt">إيصال</option><option value="other">مستند آخر</option></select>
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={documentCommitmentId} onChange={(event) => setDocumentCommitmentId(event.target.value)}><option value="">دون ربط بالتزام</option>{commitments.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
            </div>
            <Button className="w-full" onClick={uploadDocument} disabled={uploading}>{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{uploading ? "جاري الرفع" : "رفع المستند"}</Button>
          </div>
          <div className="mt-4 space-y-2">
            {data.documents.length === 0 && <p className="rounded-xl bg-muted/50 p-3 text-center text-sm text-muted-foreground">لا توجد مستندات بعد</p>}
            {data.documents.slice(0, 6).map((document) => <div key={document.id} className="flex items-center gap-2 rounded-xl border p-3"><FileText className="h-4 w-4 shrink-0 text-primary" /><a className="min-w-0 flex-1 truncate text-sm font-medium hover:underline" href={`/api/integrations/documents/${document.id}/download`}>{document.originalName}</a><Button size="icon" variant="ghost" aria-label="حذف" onClick={() => deleteDocument.mutate(document.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>)}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="mb-4 flex items-start gap-3"><div className="rounded-xl bg-violet-50 p-2 text-violet-600"><Webhook className="h-5 w-5" /></div><div><h2 className="font-bold">Webhooks وn8n</h2><p className="text-sm text-muted-foreground">أرسل أحداث التذكير والتصعيد والإكمال إلى أعمالك تلقائيًا.</p></div></div>
        <div className="grid gap-3 lg:grid-cols-[180px_1fr_auto]">
          <div><Label htmlFor="webhook-name">الاسم</Label><Input id="webhook-name" value={webhookName} onChange={(event) => setWebhookName(event.target.value)} /></div>
          <div><Label htmlFor="webhook-url">Production Webhook URL</Label><Input id="webhook-url" dir="ltr" placeholder="https://n8n.example.com/webhook/..." value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} /></div>
          <Button className="self-end" onClick={addWebhook} disabled={!webhookUrl || createWebhook.isPending}>{createWebhook.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}إضافة</Button>
        </div>
        {signingSecret && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-semibold text-amber-900">مفتاح التوقيع — يظهر مرة واحدة</p><code dir="ltr" className="mt-2 block break-all rounded bg-white p-2 text-xs">{signingSecret}</code></div>}
        <div className="mt-4 space-y-2">
          {data.webhooks.length === 0 && <p className="rounded-xl bg-muted/50 p-3 text-center text-sm text-muted-foreground">أضف رابط n8n عندما تحتاج الأتمتة الخارجية</p>}
          {data.webhooks.map((webhook) => <div key={webhook.id} className="flex flex-col gap-3 rounded-xl border p-3 md:flex-row md:items-center"><div className="min-w-0 flex-1"><p className="font-semibold">{webhook.name}</p><p dir="ltr" className="truncate text-xs text-muted-foreground">{webhook.url}</p><p className="mt-1 text-xs text-muted-foreground">آخر حالة: {webhook.lastStatus === "delivered" ? "ناجح" : webhook.lastStatus === "failed" ? "فشل" : "لم يُجرّب"}</p></div><div className="flex items-center gap-2"><Switch checked={webhook.enabled} onCheckedChange={(enabled) => toggleWebhook.mutate({ id: webhook.id, enabled })} /><Button size="sm" variant="outline" onClick={async () => { try { const result = await testWebhook.mutateAsync(webhook.id); toast({ title: result.status === "delivered" ? "نجح الاختبار" : "فشل الاختبار", description: result.error || undefined }); } catch (error) { toast({ title: "فشل الاختبار", description: errorMessage(error), variant: "destructive" }); } }}>اختبار</Button><Button size="icon" variant="ghost" onClick={() => deleteWebhook.mutate(webhook.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div></div>)}
        </div>
      </Card>
    </div>
  );
}
