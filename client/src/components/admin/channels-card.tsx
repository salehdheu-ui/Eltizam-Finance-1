import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { BellRing, KeyRound, Loader2, Send, Trash2 } from "lucide-react";
import {
  useAdminChannels,
  useAdminDeleteChannel,
  useAdminGenerateVapidKeys,
  useAdminSaveEmailChannel,
  useAdminSavePushChannel,
  useAdminTestEmailChannel,
  type AdminEmailChannel,
  type AdminPushChannel,
} from "@/lib/hooks";
import { formatDate } from "@/lib/utils";

function StatusBadge({ channel }: { channel: AdminEmailChannel | AdminPushChannel }) {
  if (channel.hasDatabaseRecord && !channel.isEnabled) {
    return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-700">موقوف</span>;
  }
  if (!channel.configured) {
    return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">غير مهيّأ</span>;
  }
  return (
    <span className="shrink-0 whitespace-nowrap rounded-full bg-emerald-100 px-2.5 py-1 text-xs text-emerald-700">
      {channel.source === "database" ? "مفعّل · محفوظ في القاعدة" : "مفعّل · من متغيرات البيئة"}
    </span>
  );
}

function ChannelShell({
  channel, description, children, actions,
}: {
  channel: AdminEmailChannel | AdminPushChannel;
  description: string;
  children: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/50 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold">{channel.label}</h3>
          <p className="text-xs text-muted-foreground mt-1 leading-6">{description}</p>
        </div>
        <StatusBadge channel={channel} />
      </div>
      {children}
      {channel.updatedAt ? (
        <p className="text-xs text-muted-foreground">آخر تحديث: {formatDate(channel.updatedAt)}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

function EmailChannelForm({ channel }: { channel: AdminEmailChannel }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState(() => ({
    host: channel.host,
    port: String(channel.port || 587),
    secure: channel.secure,
    requireAuth: channel.requireAuth,
    user: channel.user,
    pass: "",
    from: channel.from,
    isEnabled: channel.isEnabled,
  }));
  const [testTo, setTestTo] = useState("");
  const save = useAdminSaveEmailChannel();
  const remove = useAdminDeleteChannel();
  const test = useAdminTestEmailChannel();

  useEffect(() => {
    setDraft({
      host: channel.host,
      port: String(channel.port || 587),
      secure: channel.secure,
      requireAuth: channel.requireAuth,
      user: channel.user,
      pass: "",
      from: channel.from,
      isEnabled: channel.isEnabled,
    });
  }, [channel]);

  const isBusy = save.isPending || remove.isPending || test.isPending;

  const handleSave = async () => {
    if (!draft.host.trim()) {
      toast({ title: "تنبيه", description: "أدخل خادم SMTP", variant: "destructive" });
      return;
    }
    try {
      await save.mutateAsync({
        host: draft.host.trim(),
        port: Number(draft.port) || 587,
        secure: draft.secure,
        requireAuth: draft.requireAuth,
        user: draft.user.trim(),
        pass: draft.pass.trim() || undefined,
        from: draft.from.trim(),
        isEnabled: draft.isEnabled,
      });
      setDraft((current) => ({ ...current, pass: "" }));
      toast({ title: "تم الحفظ", description: "حُدّثت إعدادات البريد" });
    } catch (error) {
      toast({ title: "خطأ", description: error instanceof Error ? error.message : "تعذر الحفظ", variant: "destructive" });
    }
  };

  const handleTest = async () => {
    if (!testTo.trim()) {
      toast({ title: "تنبيه", description: "أدخل بريداً لإرسال رسالة تجريبية إليه", variant: "destructive" });
      return;
    }
    try {
      const result = await test.mutateAsync(testTo.trim());
      toast({
        title: result.ok ? "تم الإرسال" : "فشل الإرسال",
        description: result.message,
        variant: result.ok ? undefined : "destructive",
      });
    } catch (error) {
      toast({ title: "خطأ", description: error instanceof Error ? error.message : "تعذر الإرسال", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("هل تريد حذف إعدادات البريد المحفوظة؟ سيعود النظام إلى متغيرات البيئة إن وُجدت.")) return;
    try {
      await remove.mutateAsync("email");
      toast({ title: "تم الحذف" });
    } catch (error) {
      toast({ title: "خطأ", description: error instanceof Error ? error.message : "تعذر الحذف", variant: "destructive" });
    }
  };

  return (
    <ChannelShell
      channel={channel}
      description="بيانات خادم البريد الصادر. تُستخدم لتنبيهات الالتزامات ولرسائل استعادة كلمة المرور. كلمة المرور تُحفظ مشفّرة ولا تُعرض بعد الحفظ."
      actions={
        <>
          <Button onClick={handleSave} disabled={isBusy}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ إعدادات البريد"}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={isBusy || !channel.configured}>
            {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            إرسال رسالة تجريبية
          </Button>
          {channel.hasDatabaseRecord ? (
            <Button variant="destructive" size="icon" onClick={handleDelete} disabled={isBusy} aria-label="حذف إعدادات البريد">
              {remove.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="smtp-host" className="text-sm">خادم SMTP</Label>
          <Input id="smtp-host" value={draft.host} dir="ltr" placeholder="smtp.gmail.com"
            onChange={(event) => setDraft((current) => ({ ...current, host: event.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="smtp-port" className="text-sm">المنفذ</Label>
          <Input id="smtp-port" value={draft.port} dir="ltr" inputMode="numeric" placeholder="587"
            onChange={(event) => setDraft((current) => ({ ...current, port: event.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="smtp-user" className="text-sm">اسم المستخدم</Label>
          <Input id="smtp-user" value={draft.user} dir="ltr"
            onChange={(event) => setDraft((current) => ({ ...current, user: event.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="smtp-pass" className="text-sm">كلمة المرور</Label>
          <Input id="smtp-pass" type="password" value={draft.pass} dir="ltr"
            placeholder={channel.passMasked ? `محفوظة حالياً (${channel.passMasked})` : "كلمة مرور التطبيق"}
            onChange={(event) => setDraft((current) => ({ ...current, pass: event.target.value }))} />
          {channel.passMasked ? (
            <p className="text-xs text-muted-foreground">اتركها فارغة للإبقاء على الحالية.</p>
          ) : null}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="smtp-from" className="text-sm">المرسِل (From)</Label>
          <Input id="smtp-from" value={draft.from} dir="ltr" placeholder="التزام &lt;no-reply@example.com&gt;"
            onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="smtp-test-to" className="text-sm">بريد الاختبار</Label>
          <Input id="smtp-test-to" value={testTo} dir="ltr" placeholder="you@example.com"
            onChange={(event) => setTestTo(event.target.value)} />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="flex items-center justify-between rounded-xl bg-muted/40 p-3">
          <span className="text-sm">اتصال مشفّر (SSL)</span>
          <Switch checked={draft.secure} onCheckedChange={(checked) => setDraft((current) => ({ ...current, secure: checked }))} />
        </div>
        <div className="flex items-center justify-between rounded-xl bg-muted/40 p-3">
          <span className="text-sm">يتطلب مصادقة</span>
          <Switch checked={draft.requireAuth} onCheckedChange={(checked) => setDraft((current) => ({ ...current, requireAuth: checked }))} />
        </div>
        <div className="flex items-center justify-between rounded-xl bg-muted/40 p-3">
          <span className="text-sm">تفعيل القناة</span>
          <Switch checked={draft.isEnabled} onCheckedChange={(checked) => setDraft((current) => ({ ...current, isEnabled: checked }))} />
        </div>
      </div>
    </ChannelShell>
  );
}

function PushChannelForm({ channel }: { channel: AdminPushChannel }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState(() => ({
    publicKey: channel.publicKey,
    privateKey: "",
    subject: channel.subject,
    isEnabled: channel.isEnabled,
  }));
  const save = useAdminSavePushChannel();
  const remove = useAdminDeleteChannel();
  const generate = useAdminGenerateVapidKeys();

  useEffect(() => {
    setDraft({ publicKey: channel.publicKey, privateKey: "", subject: channel.subject, isEnabled: channel.isEnabled });
  }, [channel]);

  const isBusy = save.isPending || remove.isPending || generate.isPending;

  const handleGenerate = async () => {
    if (channel.configured && !window.confirm(
      "توليد زوج مفاتيح جديد يُلغي كل الأجهزة المشتركة حالياً، وسيحتاج كل مستخدم لإعادة تفعيل الإشعارات. هل تريد المتابعة؟",
    )) return;

    try {
      const keys = await generate.mutateAsync();
      setDraft((current) => ({ ...current, publicKey: keys.publicKey, privateKey: keys.privateKey }));
      toast({ title: "تم توليد المفاتيح", description: "اضغط حفظ لاعتمادها." });
    } catch (error) {
      toast({ title: "خطأ", description: error instanceof Error ? error.message : "تعذر التوليد", variant: "destructive" });
    }
  };

  const handleSave = async () => {
    if (!draft.publicKey.trim()) {
      toast({ title: "تنبيه", description: "ولّد زوج مفاتيح أو أدخل المفتاح العام", variant: "destructive" });
      return;
    }
    if (!channel.privateKeyMasked && !draft.privateKey.trim()) {
      toast({ title: "تنبيه", description: "أدخل المفتاح الخاص عند الحفظ لأول مرة", variant: "destructive" });
      return;
    }
    try {
      await save.mutateAsync({
        publicKey: draft.publicKey.trim(),
        privateKey: draft.privateKey.trim() || undefined,
        subject: draft.subject.trim(),
        isEnabled: draft.isEnabled,
      });
      setDraft((current) => ({ ...current, privateKey: "" }));
      toast({ title: "تم الحفظ", description: "حُدّثت مفاتيح الإشعارات" });
    } catch (error) {
      toast({ title: "خطأ", description: error instanceof Error ? error.message : "تعذر الحفظ", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("هل تريد حذف مفاتيح الإشعارات المحفوظة؟ ستتوقف إشعارات المتصفح ما لم تكن مضبوطة في متغيرات البيئة.")) return;
    try {
      await remove.mutateAsync("push");
      toast({ title: "تم الحذف" });
    } catch (error) {
      toast({ title: "خطأ", description: error instanceof Error ? error.message : "تعذر الحذف", variant: "destructive" });
    }
  };

  return (
    <ChannelShell
      channel={channel}
      description="مفاتيح VAPID التي يوقّع بها الخادم إشعارات المتصفح والجوال. ولّدها مرة واحدة واحفظها؛ تغييرها لاحقاً يُلغي اشتراكات الأجهزة."
      actions={
        <>
          <Button onClick={handleSave} disabled={isBusy}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ المفاتيح"}
          </Button>
          <Button variant="outline" onClick={handleGenerate} disabled={isBusy}>
            {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            توليد زوج مفاتيح
          </Button>
          {channel.hasDatabaseRecord ? (
            <Button variant="destructive" size="icon" onClick={handleDelete} disabled={isBusy} aria-label="حذف مفاتيح الإشعارات">
              {remove.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="vapid-public" className="text-sm">المفتاح العام (Public Key)</Label>
          <Input id="vapid-public" value={draft.publicKey} dir="ltr"
            onChange={(event) => setDraft((current) => ({ ...current, publicKey: event.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vapid-private" className="text-sm">المفتاح الخاص (Private Key)</Label>
          <Input id="vapid-private" type="password" value={draft.privateKey} dir="ltr"
            placeholder={channel.privateKeyMasked ? `محفوظ حالياً (${channel.privateKeyMasked})` : "المفتاح الخاص"}
            onChange={(event) => setDraft((current) => ({ ...current, privateKey: event.target.value }))} />
          {channel.privateKeyMasked ? (
            <p className="text-xs text-muted-foreground">اتركه فارغاً للإبقاء على الحالي.</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="vapid-subject" className="text-sm">جهة الاتصال (Subject)</Label>
          <Input id="vapid-subject" value={draft.subject} dir="ltr" placeholder="mailto:admin@eltizam.app"
            onChange={(event) => setDraft((current) => ({ ...current, subject: event.target.value }))} />
        </div>
        <div className="flex items-center justify-between rounded-xl bg-muted/40 p-3">
          <span className="text-sm">تفعيل القناة</span>
          <Switch checked={draft.isEnabled} onCheckedChange={(checked) => setDraft((current) => ({ ...current, isEnabled: checked }))} />
        </div>
      </div>
    </ChannelShell>
  );
}

export default function AdminChannelsCard() {
  const { data, isLoading } = useAdminChannels();

  return (
    <Card className="border-border/50 shadow-sm">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">قنوات الإشعارات</h2>
            <p className="text-sm text-muted-foreground">
              بيانات الإرسال للبريد وإشعارات المتصفح. بدونها تظهر رسالة «لم تُرسل أي قناة» عند تجربة الإشعارات. تُحفظ مشفّرة في القاعدة، وتُستخدم متغيرات البيئة عند عدم وجود إعداد محفوظ.
            </p>
          </div>
          <div className="h-11 w-11 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <BellRing className="h-5 w-5" />
          </div>
        </div>

        {isLoading || !data ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <EmailChannelForm channel={data.email} />
            <PushChannelForm channel={data.push} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
