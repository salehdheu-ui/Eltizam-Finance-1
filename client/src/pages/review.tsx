import { AlertTriangle, CheckCircle2, ClipboardCheck, ExternalLink, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { Link } from "wouter";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLedgerReconciliation, useReviewSummary } from "@/lib/hooks";
import { formatCurrency, formatRelativeArabicDate } from "@/lib/utils";

export default function ReviewPage() {
  const { data, isLoading, isError } = useReviewSummary();
  const { data: reconciliation } = useLedgerReconciliation();

  if (isLoading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (isError || !data) {
    return <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive" dir="rtl">تعذر تحميل مركز المراجعة. أعد المحاولة لاحقاً.</div>;
  }

  const totalPending = data.counts.pendingEvents + data.counts.balanceGaps + data.counts.orphanedEvents;

  return (
    <div className="space-y-6 pb-24" dir="rtl">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary"><ClipboardCheck className="h-5 w-5" /><span className="text-sm font-bold">التحكم والثقة</span></div>
          <h1 className="text-2xl font-black sm:text-3xl">مركز المراجعة</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">كل ما يحتاج قراراً أو تفسيراً مالياً في مكان واحد، مع إبقاء الحركات الأصلية قابلة للتتبع.</p>
        </div>
        <Link href="/bank-inbox"><Button variant="outline">فتح البريد البنكي <ExternalLink className="mr-2 h-4 w-4" /></Button></Link>
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryCard label="تحتاج قراراً" value={totalPending} icon={<TriangleAlert className="h-5 w-5" />} tone="amber" />
        <SummaryCard label="فجوات الرصيد" value={data.counts.balanceGaps} icon={<AlertTriangle className="h-5 w-5" />} tone="rose" />
        <SummaryCard label="أحداث بلا ربط" value={data.counts.orphanedEvents} icon={<ExternalLink className="h-5 w-5" />} tone="slate" />
        <SummaryCard label="حركات عكسية" value={data.counts.reversals} icon={<RotateCcw className="h-5 w-5" />} tone="emerald" />
      </div>

      <Card className={reconciliation?.matched ? "border-emerald-500/20 bg-emerald-500/[0.03]" : "border-amber-500/30 bg-amber-500/[0.04]"}>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className={reconciliation?.matched ? "flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600" : "flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700"}>
              {reconciliation?.matched ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
            </div>
            <div>
              <p className="font-bold">مطابقة الرصيد مع السجل المالي</p>
              <p className="mt-1 text-xs text-muted-foreground">{reconciliation ? (reconciliation.matched ? "كل المحافظ متطابقة مع مجموع ledger" : `${reconciliation.mismatchedWallets.length} محفظة تحتاج فحصاً`) : "جاري الفحص..."}</p>
            </div>
          </div>
          {reconciliation && !reconciliation.matched ? <div className="text-sm font-bold text-amber-700">فرق {formatCurrency(Math.abs(reconciliation.mismatchedWallets.reduce((sum, wallet) => sum + wallet.difference, 0)), 3)} ﷼</div> : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <ReviewList title="حركات بنكية تنتظر التأكيد" empty="لا توجد حركات بنكية معلقة" icon={<ClipboardCheck className="h-5 w-5 text-amber-600" />}>
          {data.pendingEvents.map((event) => (
            <ReviewRow key={event.id} title={event.merchant || "معاملة بنكية"} meta={`${event.accountRef || "حساب غير محدد"} · ${formatRelativeArabicDate(event.receivedAt)}`} amount={event.amount} tone="amber" />
          ))}
        </ReviewList>

        <ReviewList title="فجوات تحتاج تسوية" empty="لا توجد فجوات رصيد مسجلة" icon={<AlertTriangle className="h-5 w-5 text-rose-600" />}>
          {data.balanceGaps.map((event) => (
            <ReviewRow key={event.id} title={event.merchant || "فجوة في الرصيد"} meta={`${event.direction === "credit" ? "إيداع" : "خصم"} · ${formatRelativeArabicDate(event.receivedAt)}`} amount={event.gapAmount} tone="rose" />
          ))}
        </ReviewList>

        <ReviewList title="أحداث بنكية بلا اتصال" empty="لا توجد أحداث يتيمة" icon={<ExternalLink className="h-5 w-5 text-slate-600" />}>
          {data.orphanedEvents.map((event) => (
            <ReviewRow key={event.id} title={event.merchant || "حدث بنكي"} meta={`${event.status} · ${formatRelativeArabicDate(event.receivedAt)}`} amount={null} tone="slate" />
          ))}
        </ReviewList>

        <ReviewList title="سجل التصحيحات" empty="لم تُنشأ حركات عكسية بعد" icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}>
          {data.reversals.map((transaction) => (
            <ReviewRow key={transaction.id} title={transaction.note || `عكس الحركة #${transaction.reversalOfId ?? ""}`} meta={formatRelativeArabicDate(transaction.date)} amount={transaction.amount} tone="emerald" />
          ))}
        </ReviewList>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, icon, tone }: { label: string; value: number; icon: ReactNode; tone: "amber" | "rose" | "slate" | "emerald" }) {
  const tones = {
    amber: "bg-amber-500/10 text-amber-700",
    rose: "bg-rose-500/10 text-rose-700",
    slate: "bg-slate-500/10 text-slate-700",
    emerald: "bg-emerald-500/10 text-emerald-700",
  };
  return <Card><CardContent className="flex items-center gap-3 p-4"><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>{icon}</div><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-black">{value}</p></div></CardContent></Card>;
}

function ReviewList({ title, empty, icon, children }: { title: string; empty: string; icon: ReactNode; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return <Card><CardHeader className="flex flex-row items-center gap-2 space-y-0 p-4 pb-2"><span>{icon}</span><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="space-y-2 p-4 pt-2">{hasChildren ? children : <p className="rounded-xl bg-muted/40 p-4 text-center text-sm text-muted-foreground">{empty}</p>}</CardContent></Card>;
}

function ReviewRow({ title, meta, amount, tone }: { title: string; meta: string; amount: number | null; tone: "amber" | "rose" | "slate" | "emerald" }) {
  const amountClass = tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : "text-foreground";
  return <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 p-3"><div className="min-w-0"><p className="truncate text-sm font-bold">{title}</p><p className="mt-1 text-xs text-muted-foreground">{meta}</p></div>{amount === null ? null : <span className={`shrink-0 text-sm font-bold ${amountClass}`}>{formatCurrency(Math.abs(amount), 2)} ﷼</span>}</div>;
}
