import { useEffect, useState } from "react";
import type { Commitment } from "@shared/schema";
import { Bell, Bot, Clock3, History, Loader2, RefreshCw, RotateCcw, UserRoundCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  useCommitmentAutomation,
  useDelegateCommitment,
  useRunCommitmentAutomation,
  useSnoozeCommitment,
  useUndoCommitmentAutomation,
  useUpdateCommitmentAutomation,
} from "@/lib/hooks";

const reminderOptions = [
  { value: 0, label: "وقت الموعد" },
  { value: 60, label: "قبل ساعة" },
  { value: 1440, label: "قبل يوم" },
  { value: 2880, label: "قبل يومين" },
  { value: 10080, label: "قبل أسبوع" },
];

const escalationOptions = [
  { value: 0, label: "فور التأخر" },
  { value: 60, label: "بعد ساعة" },
  { value: 1440, label: "بعد يوم" },
  { value: 4320, label: "بعد 3 أيام" },
  { value: 10080, label: "بعد أسبوع" },
];

const statusLabels: Record<string, string> = {
  pending: "قادم",
  snoozed: "مؤجل",
  overdue: "متأخر",
  completed: "مكتمل",
  cancelled: "ملغي",
};

const actionIcons: Record<string, typeof Bell> = {
  reminder: Bell,
  escalated: Zap,
  delegated: UserRoundCheck,
  snoozed: Clock3,
  undone: RotateCcw,
};

function formatDateTime(timestamp: number | null) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("ar-OM", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp * 1000));
}

export function CommitmentAutomationCard({ commitment }: { commitment: Pick<Commitment, "id" | "type"> }) {
  const { toast } = useToast();
  const { data, isLoading } = useCommitmentAutomation(commitment.id);
  const updateSettings = useUpdateCommitmentAutomation(commitment.id);
  const snooze = useSnoozeCommitment(commitment.id);
  const delegate = useDelegateCommitment(commitment.id);
  const runNow = useRunCommitmentAutomation(commitment.id);
  const undo = useUndoCommitmentAutomation(commitment.id);
  const [delegateName, setDelegateName] = useState("");
  const [delegateContact, setDelegateContact] = useState("");

  useEffect(() => {
    if (!data?.settings) return;
    setDelegateName(data.settings.delegatedTo || "");
    setDelegateContact(data.settings.delegatedContact || "");
  }, [data?.settings]);

  const saveSetting = async (value: Record<string, boolean | number>) => {
    try {
      await updateSettings.mutateAsync(value);
      toast({ title: "تم حفظ الأتمتة" });
    } catch (error) {
      toast({ title: "تعذر حفظ الأتمتة", description: error instanceof Error ? error.message : "حاول مرة أخرى", variant: "destructive" });
    }
  };

  const handleDelegate = async () => {
    try {
      await delegate.mutateAsync({
        delegatedTo: delegateName.trim() || null,
        delegatedContact: delegateContact.trim() || null,
      });
      toast({ title: delegateName.trim() ? "تم التفويض" : "تم إلغاء التفويض" });
    } catch (error) {
      toast({ title: "تعذر حفظ التفويض", description: error instanceof Error ? error.message : "حاول مرة أخرى", variant: "destructive" });
    }
  };

  const handleSnooze = async (minutes: number) => {
    try {
      await snooze.mutateAsync(minutes);
      toast({ title: minutes === 60 ? "تم التأجيل ساعة" : "تم التأجيل إلى الغد" });
    } catch (error) {
      toast({ title: "تعذر التأجيل", description: error instanceof Error ? error.message : "لا توجد مرة تنفيذ قابلة للتأجيل", variant: "destructive" });
    }
  };

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          تشغيل محرك الأتمتة...
        </CardContent>
      </Card>
    );
  }

  const settings = data.settings;
  const activeOccurrence = data.occurrences.find((item) => item.status !== "completed" && item.status !== "cancelled");

  return (
    <Card className="overflow-hidden border-primary/15">
      <CardHeader className="border-b bg-primary/5 pb-4">
        <CardTitle className="flex items-center justify-between gap-3 text-lg">
          <span className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Bot className="h-5 w-5" /></span>
            محرك الأتمتة
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-normal text-muted-foreground">{settings.enabled ? "يعمل في الخلفية" : "متوقف"}</span>
            <Switch checked={settings.enabled} onCheckedChange={(enabled) => saveSetting({ enabled })} />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-semibold">
            <span className="flex items-center gap-2"><Bell className="h-4 w-4 text-primary" />التذكير</span>
            <select
              value={settings.reminderMinutes}
              onChange={(event) => saveSetting({ reminderMinutes: Number(event.target.value) })}
              className="h-11 w-full rounded-xl border bg-background px-3 font-normal"
              disabled={!settings.enabled}
            >
              {reminderOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="space-y-2 text-sm font-semibold">
            <span className="flex items-center gap-2"><Zap className="h-4 w-4 text-amber-600" />التصعيد</span>
            <select
              value={settings.escalationMinutes}
              onChange={(event) => saveSetting({ escalationMinutes: Number(event.target.value) })}
              className="h-11 w-full rounded-xl border bg-background px-3 font-normal"
              disabled={!settings.enabled}
            >
              {escalationOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border p-3">
            <div>
              <p className="text-sm font-semibold">إغلاق عند وصول إثبات</p>
              <p className="mt-1 text-xs text-muted-foreground">إيصال أو رابط أو ملاحظة</p>
            </div>
            <Switch checked={settings.autoCloseOnProof} onCheckedChange={(autoCloseOnProof) => saveSetting({ autoCloseOnProof })} />
          </div>
          {commitment.type === "financial" ? (
            <div className="flex items-center justify-between rounded-xl border p-3">
              <div>
                <p className="text-sm font-semibold">إغلاق عند وصول دفعة</p>
                <p className="mt-1 text-xs text-muted-foreground">من رسائل البنك المرتبطة</p>
              </div>
              <Switch checked={settings.autoCloseOnPayment} onCheckedChange={(autoCloseOnPayment) => saveSetting({ autoCloseOnPayment })} />
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl bg-muted/40 p-4">
          <div className="mb-3 flex items-center gap-2 font-semibold"><UserRoundCheck className="h-4 w-4 text-primary" />التفويض</div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="automation-delegate">اسم الشخص</Label>
              <Input id="automation-delegate" value={delegateName} onChange={(event) => setDelegateName(event.target.value)} placeholder="مثال: أحمد" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="automation-contact">وسيلة التواصل</Label>
              <Input id="automation-contact" value={delegateContact} onChange={(event) => setDelegateContact(event.target.value)} placeholder="هاتف أو بريد (اختياري)" />
            </div>
            <Button type="button" variant="outline" className="self-end" onClick={handleDelegate} disabled={delegate.isPending}>حفظ</Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => handleSnooze(60)} disabled={snooze.isPending || !activeOccurrence}>
            <Clock3 className="h-4 w-4" />تأجيل ساعة
          </Button>
          <Button type="button" variant="outline" onClick={() => handleSnooze(1440)} disabled={snooze.isPending || !activeOccurrence}>
            <Clock3 className="h-4 w-4" />تأجيل للغد
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={async () => {
              await runNow.mutateAsync();
              toast({ title: "تم تشغيل المحرك الآن" });
            }}
            disabled={runNow.isPending}
          >
            {runNow.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            تشغيل الآن
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 flex items-center gap-2 font-semibold"><Clock3 className="h-4 w-4 text-primary" />مرات التنفيذ</h3>
            {data.occurrences.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">ستظهر أول مرة تنفيذ عند اقتراب الموعد.</p>
            ) : (
              <div className="space-y-2">
                {data.occurrences.slice(0, 5).map((occurrence) => (
                  <div key={occurrence.id} className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm">
                    <span>{formatDateTime(occurrence.snoozedUntil || occurrence.scheduledFor)}</span>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs">{statusLabels[occurrence.status] || occurrence.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-3 flex items-center gap-2 font-semibold"><History className="h-4 w-4 text-primary" />ما نفذه النظام</h3>
            {data.logs.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">لا توجد أعمال آلية بعد.</p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {data.logs.slice(0, 12).map((log) => {
                  const Icon = actionIcons[log.action] || Bot;
                  return (
                    <div key={log.id} className="flex items-start gap-3 rounded-xl border p-3">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className={log.undoneAt ? "text-sm text-muted-foreground line-through" : "text-sm font-medium"}>{log.summary}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(log.createdAt)}</p>
                      </div>
                      {log.undoPayload && !log.undoneAt ? (
                        <Button type="button" size="sm" variant="ghost" onClick={() => undo.mutate(log.id)} disabled={undo.isPending}>
                          <RotateCcw className="h-3.5 w-3.5" />تراجع
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
