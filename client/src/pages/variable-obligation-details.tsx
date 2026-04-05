import { ArrowRight, Calendar, CheckCircle2, Clock3, Loader2, Receipt, XCircle } from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useObligation, useUpdateVariableObligationMonthStatus, useVariableObligationStatuses } from "@/lib/hooks";
import { ApiError } from "@/lib/queryClient";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

const monthFormatter = {
  format: (date: Date) => {
    const month = date.toLocaleDateString("ar-OM", { month: "long" });
    const year = date.getFullYear();
    return `${month} ${year}`;
  },
};

type MonthStatusValue = "paid" | "late" | "unpaid";

type MonthTimelineItem = {
  monthKey: string;
  date: Date;
  status: MonthStatusValue;
  paidAt?: number | null;
  note?: string | null;
};

const statusMeta: Record<MonthStatusValue, { label: string; className: string }> = {
  paid: {
    label: "مدفوع",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  },
  late: {
    label: "متأخر",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  },
  unpaid: {
    label: "غير مدفوع",
    className: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
  },
};

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function formatMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parseMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function getDefaultMonthStatus(monthDate: Date) {
  const currentMonth = startOfMonth(new Date());
  return monthDate < currentMonth ? "late" : "unpaid";
}

function normalizeMonthStatus(status: string): MonthStatusValue {
  if (status === "paid" || status === "late") {
    return status;
  }
  return "unpaid";
}

function buildMonthTimeline(
  startDateUnix: number,
  endDateUnix: number | null,
  statuses: Array<{ monthKey: string; status: MonthStatusValue; paidAt?: number | null; note?: string | null }>,
): MonthTimelineItem[] {
  const startDate = startOfMonth(new Date(startDateUnix * 1000));
  const minimumEnd = addMonths(startOfMonth(new Date()), 5);
  const rawEndDate = endDateUnix ? startOfMonth(new Date(endDateUnix * 1000)) : minimumEnd;
  const endDate = rawEndDate > minimumEnd ? rawEndDate : minimumEnd;
  const boundedEndDate = addMonths(startDate, 23) < endDate ? addMonths(startDate, 23) : endDate;
  const statusMap = new Map(statuses.map((item) => [item.monthKey, item]));
  const months: MonthTimelineItem[] = [];

  for (let cursor = new Date(startDate); cursor <= boundedEndDate; cursor = addMonths(cursor, 1)) {
    const monthKey = formatMonthKey(cursor);
    const saved = statusMap.get(monthKey);
    months.push({
      monthKey,
      date: new Date(cursor),
      status: saved?.status ?? getDefaultMonthStatus(cursor),
      paidAt: saved?.paidAt,
      note: saved?.note,
    });
  }

  return months.reverse();
}

export default function VariableObligationDetails() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/obligations/:id");
  const obligationId = params?.id ? parseInt(params.id, 10) : undefined;
  const { toast } = useToast();
  const [pendingMonthKey, setPendingMonthKey] = useState<string | null>(null);
  const { data: obligation, isLoading: isLoadingObligation } = useObligation(obligationId);
  const { data: statuses = [], isLoading: isLoadingStatuses } = useVariableObligationStatuses(obligationId);
  const updateStatus = useUpdateVariableObligationMonthStatus(obligationId);
  const normalizedStatuses = statuses.map((item) => ({
    ...item,
    status: normalizeMonthStatus(item.status),
  }));

  const timeline = obligation?.startDate
    ? buildMonthTimeline(obligation.startDate, obligation.endDate ?? null, normalizedStatuses)
    : [];

  const stats = timeline.reduce(
    (acc, month) => {
      acc[month.status] += 1;
      return acc;
    },
    {
      paid: 0,
      late: 0,
      unpaid: 0,
    } as Record<MonthStatusValue, number>,
  );

  const handleUpdateStatus = async (monthKey: string, status: MonthStatusValue) => {
    if (updateStatus.isPending) {
      return;
    }

    setPendingMonthKey(monthKey);
    try {
      await updateStatus.mutateAsync({ monthKey, status });
      toast({
        title: "تم تحديث الحالة",
        description: `تم حفظ حالة شهر ${monthFormatter.format(parseMonthKey(monthKey))}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذر تحديث حالة الشهر";
      const queueWaitMessage = error instanceof ApiError && error.queueWaitMs && error.queueWaitMs >= 1000
        ? ` بعد انتظار ${Math.ceil(error.queueWaitMs / 1000)} ثانية في طابور الحفظ`
        : "";
      toast({
        title: "خطأ",
        description: `${message}${queueWaitMessage}`,
        variant: "destructive",
      });
    } finally {
      setPendingMonthKey(null);
    }
  };

  if (isLoadingObligation || isLoadingStatuses) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!obligation || obligation.scheduleType !== "variable") {
    return (
      <div className="flex flex-col gap-4 p-4 pt-8">
        <Button variant="ghost" className="w-fit rounded-full" onClick={() => setLocation("/obligations")}>
          <ArrowRight className="ml-2 h-4 w-4" />
          العودة للالتزامات
        </Button>
        <Card className="border border-border/50 shadow-sm">
          <CardContent className="p-6 text-center space-y-3">
            <Receipt className="mx-auto h-10 w-10 text-muted-foreground" />
            <h1 className="text-lg font-bold">تفاصيل غير متاحة</h1>
            <p className="text-sm text-muted-foreground">هذا الالتزام غير موجود أو ليس من النوع المتغير.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="app-page animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" className="w-fit rounded-full" onClick={() => setLocation("/obligations")}>
          <ArrowRight className="ml-2 h-4 w-4" />
          العودة
        </Button>
        <Badge className="w-fit bg-primary/10 text-primary hover:bg-primary/10">التزام متغير</Badge>
      </div>

      <Card className="border border-border/50 shadow-sm overflow-hidden">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-xl font-bold sm:text-2xl">{obligation.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">صفحة متابعة الأشهر وحالة الدفع والتأخير وعدم الدفع.</p>
            </div>
            <div className="text-right sm:text-left">
              <p className="text-xs text-muted-foreground">المبلغ</p>
              <p className="break-words font-bold text-destructive">{formatCurrency(obligation.amount)} ر.ع</p>
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-xl bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">تاريخ البداية</p>
              <p className="mt-1 font-semibold">{formatDate(obligation.startDate)}</p>
            </div>
            <div className="rounded-xl bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">تاريخ الانتهاء</p>
              <p className="mt-1 font-semibold">{obligation.endDate ? formatDate(obligation.endDate) : "مفتوح"}</p>
            </div>
            <div className="rounded-xl bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">موعد الدفع الحالي</p>
              <p className="mt-1 font-semibold">{obligation.dueDate ? formatDate(obligation.dueDate) : "غير محدد"}</p>
            </div>
            <div className="rounded-xl bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">عدد الأشهر المعروضة</p>
              <p className="mt-1 font-semibold">{timeline.length}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="border border-emerald-200 bg-emerald-50/60 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/20">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">المدفوع</p>
            <p className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.paid}</p>
          </CardContent>
        </Card>
        <Card className="border border-amber-200 bg-amber-50/60 shadow-sm dark:border-amber-900 dark:bg-amber-950/20">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">المتأخر</p>
            <p className="mt-2 text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.late}</p>
          </CardContent>
        </Card>
        <Card className="border border-slate-200 bg-slate-50/60 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">غير مدفوع</p>
            <p className="mt-2 text-2xl font-bold text-slate-700 dark:text-slate-300">{stats.unpaid}</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          <h2 className="font-bold text-lg">تفاصيل الأشهر</h2>
        </div>

        <div className="flex flex-col gap-3">
          {timeline.map((month) => {
            const status = statusMeta[month.status];
            return (
              <Card key={month.monthKey} className="border border-border/50 shadow-sm">
                <CardContent className="space-y-4 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h3 className="font-semibold">{monthFormatter.format(month.date)}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">رمز الشهر: {month.monthKey}</p>
                    </div>
                    <Badge className={cn("w-fit hover:bg-transparent", status.className)}>{status.label}</Badge>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={month.status === "paid" ? "default" : "outline"}
                      className="rounded-full"
                      onClick={() => handleUpdateStatus(month.monthKey, "paid")}
                      disabled={updateStatus.isPending}
                    >
                      {updateStatus.isPending && pendingMonthKey === month.monthKey && month.status !== "paid" ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="ml-1 h-4 w-4" />}
                      مدفوع
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={month.status === "late" ? "default" : "outline"}
                      className="rounded-full"
                      onClick={() => handleUpdateStatus(month.monthKey, "late")}
                      disabled={updateStatus.isPending}
                    >
                      {updateStatus.isPending && pendingMonthKey === month.monthKey && month.status !== "late" ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : <Clock3 className="ml-1 h-4 w-4" />}
                      متأخر
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={month.status === "unpaid" ? "default" : "outline"}
                      className="rounded-full"
                      onClick={() => handleUpdateStatus(month.monthKey, "unpaid")}
                      disabled={updateStatus.isPending}
                    >
                      {updateStatus.isPending && pendingMonthKey === month.monthKey && month.status !== "unpaid" ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : <XCircle className="ml-1 h-4 w-4" />}
                      غير مدفوع
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground sm:gap-4">
                    <span>الحالة الحالية: {status.label}</span>
                    {updateStatus.isPending && pendingMonthKey === month.monthKey ? <span>جاري حفظ التحديث...</span> : null}
                    {month.paidAt ? <span>تم السداد: {formatDate(month.paidAt)}</span> : null}
                    {month.note ? <span>ملاحظة: {month.note}</span> : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
