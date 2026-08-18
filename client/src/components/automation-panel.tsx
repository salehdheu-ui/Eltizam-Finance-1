import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { AlarmClock, Bot, CalendarClock, Check, Loader2, RotateCcw, Undo2 } from "lucide-react";
import {
  useAutomationLog,
  useUpcomingOccurrences,
  useRunAutomation,
  useUndoAutomation,
  usePostponeOccurrence,
  useSetOccurrenceStatus,
} from "@/lib/hooks";
import { CurrencyDisplay } from "@/components/ui/currency-display";

const DAY = 86400;

const ACTION_LABELS: Record<string, string> = {
  occurrence_created: "موعد جديد",
  reminder_due: "تذكير",
  marked_missed: "فات الموعد",
  escalated: "تصعيد",
  auto_closed: "إغلاق تلقائي",
  postponed: "تأجيل",
  weekly_summary: "ملخص أسبوعي",
};

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("ar-OM", { dateStyle: "medium" }).format(new Date(timestamp * 1000));
}

function describeDue(dueDate: number) {
  const days = Math.round((dueDate - Date.now() / 1000) / DAY);
  if (days < -1) return { text: `متأخر ${Math.abs(days)} يوماً`, tone: "text-red-600" };
  if (days <= 0) return { text: "اليوم", tone: "text-amber-700" };
  if (days === 1) return { text: "غداً", tone: "text-amber-700" };
  return { text: `بعد ${days} يوماً`, tone: "text-muted-foreground" };
}

export default function AutomationPanel() {
  const { toast } = useToast();
  const { data: occurrences = [], isLoading: loadingOccurrences } = useUpcomingOccurrences();
  const { data: log = [] } = useAutomationLog();
  const runAutomation = useRunAutomation();
  const undoEntry = useUndoAutomation();
  const postpone = usePostponeOccurrence();
  const setStatus = useSetOccurrenceStatus();

  const handleRun = async () => {
    try {
      const totals = await runAutomation.mutateAsync();
      const parts = [
        totals.occurrences ? `${totals.occurrences} موعد` : "",
        totals.reminders ? `${totals.reminders} تذكير` : "",
        totals.sharedReminders ? `${totals.sharedReminders} تذكير مشترك` : "",
        totals.missed ? `${totals.missed} فائت` : "",
        totals.escalated || totals.sharedEscalated ? `${totals.escalated + totals.sharedEscalated} تصعيد` : "",
        totals.closed ? `${totals.closed} أُغلق` : "",
        totals.weeklySummaries ? "ملخص أسبوعي" : "",
      ].filter(Boolean);
      toast({
        title: "تم تحديث المواعيد",
        description: parts.length ? parts.join(" · ") : "لا جديد — كل شيء محدَّث.",
      });
    } catch (error) {
      toast({ title: "تعذر التشغيل", description: error instanceof Error ? error.message : "حاول مرة أخرى", variant: "destructive" });
    }
  };

  const upcoming = occurrences.slice(0, 8);

  return (
    <div className="space-y-4">
      <Card className="p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CalendarClock className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-bold">المواعيد القادمة</h2>
              <p className="text-sm text-muted-foreground">يولّدها النظام من التزاماتك المتكررة.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleRun} disabled={runAutomation.isPending}>
            {runAutomation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            تحديث
          </Button>
        </div>

        {loadingOccurrences ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : upcoming.length === 0 ? (
          <p className="rounded-xl bg-muted/40 p-4 text-center text-sm text-muted-foreground">
            لا مواعيد قادمة. أضف التزاماً بموعد استحقاق وسيتولى النظام الباقي.
          </p>
        ) : (
          <div className="space-y-2">
            {upcoming.map((occurrence) => {
              const due = describeDue(occurrence.dueDate);
              return (
                <div key={occurrence.id} className="rounded-xl border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{occurrence.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDate(occurrence.dueDate)} · <span className={due.tone}>{due.text}</span>
                        {occurrence.postponedFrom ? " · مؤجَّل" : ""}
                        {occurrence.delegatedTo ? ` · بعهدة ${occurrence.delegatedTo}` : ""}
                      </p>
                    </div>
                    {typeof occurrence.amount === "number" ? (
                      <span className="shrink-0 font-bold"><CurrencyDisplay amount={occurrence.amount} fractionDigits={3} /></span>
                    ) : null}
                  </div>

                  {occurrence.escalatedAt ? (
                    <p className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">
                      مُصعَّد — تجاوز المهلة التي حددتها.
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => setStatus.mutate({ id: occurrence.id, status: "completed" })}
                      disabled={setStatus.isPending}
                    >
                      <Check className="h-4 w-4" /> تم
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => postpone.mutate({ id: occurrence.id, days: 1 })}
                      disabled={postpone.isPending}
                    >
                      <AlarmClock className="h-4 w-4" /> للغد
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => postpone.mutate({ id: occurrence.id, days: 7 })}
                      disabled={postpone.isPending}
                    >
                      أسبوع
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => postpone.mutate({ id: occurrence.id, days: 30 })}
                      disabled={postpone.isPending}
                    >
                      شهر
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setStatus.mutate({ id: occurrence.id, status: "skipped" })}
                      disabled={setStatus.isPending}
                    >
                      تخطَّ
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-bold">ما نفّذه النظام</h2>
            <p className="text-sm text-muted-foreground">كل إجراء تلقائي مسجّل، وما يمكن التراجع عنه عليه زر.</p>
          </div>
        </div>

        {log.length === 0 ? (
          <p className="rounded-xl bg-muted/40 p-4 text-center text-sm text-muted-foreground">
            لم ينفّذ النظام شيئاً بعد.
          </p>
        ) : (
          <div className="space-y-2">
            {log.slice(0, 12).map((entry) => (
              <div key={entry.id} className="flex items-start justify-between gap-3 rounded-xl border p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {ACTION_LABELS[entry.action] || entry.action}
                    </span>
                    {entry.undoneAt ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">تم التراجع</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm">{entry.summary}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatDate(entry.createdAt)}</p>
                </div>

                {entry.canUndo ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => undoEntry.mutate(entry.id)}
                    disabled={undoEntry.isPending}
                  >
                    <Undo2 className="h-4 w-4" /> تراجع
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
