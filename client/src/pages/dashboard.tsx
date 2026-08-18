import { Calendar, ChevronLeft, CircleAlert, Clock3, ListChecks, Loader2, Receipt, Settings, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { useMemo } from "react";
import { cn, formatObligationDueDate, formatRelativeArabicDate, getUpcomingObligations, normalizeArabicText } from "@/lib/utils";
import { Link } from "wouter";
import { useCommitments, useDashboard, useObligations, useUser } from "@/lib/hooks";
import type { Commitment } from "@shared/schema";
import InsightsPanel from "@/components/insights-panel";

function startOfTodayTimestamp() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor(today.getTime() / 1000);
}

function getCommitmentTiming(commitment: Commitment, today: number) {
  if (!commitment.dueDate) {
    return { label: "بدون موعد", tone: "neutral" as const, daysLeft: Number.MAX_SAFE_INTEGER };
  }

  const dueDate = new Date(commitment.dueDate * 1000);
  dueDate.setHours(0, 0, 0, 0);
  const dueTimestamp = Math.floor(dueDate.getTime() / 1000);
  const daysLeft = Math.round((dueTimestamp - today) / (24 * 60 * 60));

  if (daysLeft < 0) return { label: `متأخر ${Math.abs(daysLeft)} يوم`, tone: "danger" as const, daysLeft };
  if (daysLeft === 0) return { label: "اليوم", tone: "warning" as const, daysLeft };
  if (daysLeft === 1) return { label: "غداً", tone: "soon" as const, daysLeft };
  if (daysLeft <= 7) return { label: `بعد ${daysLeft} أيام`, tone: "soon" as const, daysLeft };
  return { label: new Intl.DateTimeFormat("ar-OM", { day: "numeric", month: "short" }).format(dueDate), tone: "neutral" as const, daysLeft };
}

export default function Dashboard() {
  const { data: user } = useUser();
  const { data: dashboard, isLoading } = useDashboard();
  const { data: obligations, isLoading: isLoadingObligations } = useObligations();
  const { data: commitments = [], isLoading: isLoadingCommitments } = useCommitments();
  const today = useMemo(startOfTodayTimestamp, []);

  const activeCommitments = useMemo(
    () => commitments.filter((commitment) => commitment.status === "active"),
    [commitments],
  );
  const evaluatedCommitments = useMemo(
    () => activeCommitments
      .map((commitment) => ({ commitment, timing: getCommitmentTiming(commitment, today) }))
      .sort((first, second) => {
        if (first.timing.daysLeft !== second.timing.daysLeft) {
          return first.timing.daysLeft - second.timing.daysLeft;
        }
        return second.commitment.createdAt - first.commitment.createdAt;
      }),
    [activeCommitments, today],
  );
  const priorityCommitments = evaluatedCommitments.slice(0, 5);
  const overdueCount = evaluatedCommitments.filter(({ timing }) => timing.tone === "danger").length;
  const todayCount = evaluatedCommitments.filter(({ timing }) => timing.tone === "warning").length;
  const weekCount = evaluatedCommitments.filter(({ timing }) => timing.daysLeft >= 0 && timing.daysLeft <= 7).length;
  const upcomingObligations = getUpcomingObligations(obligations, 3);
  const hasFinancialActivity = (dashboard?.recentTransactions?.length ?? 0) > 0
    || (dashboard?.totalBalance ?? 0) !== 0
    || (dashboard?.totalIncome ?? 0) !== 0
    || (dashboard?.totalExpenses ?? 0) !== 0;
  const isLoadingImportant = isLoadingCommitments || isLoadingObligations;

  return (
    <div className="animate-in fade-in flex flex-col gap-5 px-1 py-4 pb-24 duration-300 sm:gap-6 sm:px-2 sm:py-6 xl:px-0 xl:py-8" dir="rtl">
      <header className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">مرحباً بعودتك</p>
          <h1 className="truncate text-xl font-bold sm:text-2xl">{user?.name || "المستخدم"}</h1>
        </div>
        <Link href="/settings">
          <div className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-primary/10 text-primary transition-colors hover:bg-primary/20" aria-label="الإعدادات">
            <Settings className="h-5 w-5" />
          </div>
        </Link>
      </header>

      <Card className="overflow-hidden border-none bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-xl">
        <CardContent className="relative p-5 sm:p-6">
          <div className="absolute -left-8 -top-8 h-28 w-28 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-primary-foreground/75">ما المهم الآن؟</p>
                <h2 className="mt-1 text-2xl font-black">يومك في نظرة واحدة</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-primary-foreground/80">ابدأ بالأقرب، واترك التفاصيل للنظام.</p>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15">
                <Sparkles className="h-6 w-6" />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
              <div className="rounded-2xl bg-white/10 p-3 text-center backdrop-blur-sm">
                <p className="text-2xl font-black">{overdueCount}</p>
                <p className="mt-1 text-[11px] text-primary-foreground/75 sm:text-xs">متأخر</p>
              </div>
              <div className="rounded-2xl bg-white/10 p-3 text-center backdrop-blur-sm">
                <p className="text-2xl font-black">{todayCount}</p>
                <p className="mt-1 text-[11px] text-primary-foreground/75 sm:text-xs">اليوم</p>
              </div>
              <div className="rounded-2xl bg-white/10 p-3 text-center backdrop-blur-sm">
                <p className="text-2xl font-black">{weekCount}</p>
                <p className="mt-1 text-[11px] text-primary-foreground/75 sm:text-xs">هذا الأسبوع</p>
              </div>
            </div>

            <Link href="/commitments">
              <Button variant="secondary" className="mt-5 h-12 w-full rounded-xl font-bold text-primary sm:w-auto">
                <ListChecks className="h-5 w-5" />
                إضافة التزام
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      <InsightsPanel />

      <section className="xl:max-w-4xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">الأولوية الآن</h2>
            <p className="text-sm text-muted-foreground">الأقرب أولاً، ثم بقية التزاماتك</p>
          </div>
          {activeCommitments.length > 0 ? (
            <Link href="/commitments"><Button variant="link" className="h-auto p-0">عرض الكل</Button></Link>
          ) : null}
        </div>

        {isLoadingImportant ? (
          <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>
        ) : priorityCommitments.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {priorityCommitments.map(({ commitment, timing }) => (
              <Link key={commitment.id} href={`/commitments/${commitment.id}`}>
                <Card className={cn(
                  "cursor-pointer border-border/60 shadow-sm transition-colors hover:bg-muted/30",
                  timing.tone === "danger" && "border-red-200 bg-red-50/60",
                  timing.tone === "warning" && "border-amber-200 bg-amber-50/60",
                )}>
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
                      timing.tone === "danger" ? "bg-red-100 text-red-700" : timing.tone === "warning" ? "bg-amber-100 text-amber-700" : "bg-primary/10 text-primary",
                    )}>
                      {timing.tone === "danger" ? <CircleAlert className="h-5 w-5" /> : <Clock3 className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-bold">{commitment.title}</h3>
                      <p className={cn("mt-1 text-xs", timing.tone === "danger" ? "text-red-700" : timing.tone === "warning" ? "text-amber-700" : "text-muted-foreground")}>{timing.label}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-emerald-600" style={{ width: `${commitment.progress}%` }} />
                        </div>
                        <span className="text-[11px] font-semibold text-emerald-700">{commitment.progress}%</span>
                      </div>
                    </div>
                    <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="border-dashed bg-muted/20">
            <CardContent className="py-9 text-center">
              <ListChecks className="mx-auto h-9 w-9 text-primary/60" />
              <h3 className="mt-3 font-bold">لا توجد التزامات نشطة</h3>
              <p className="mt-1 text-sm text-muted-foreground">أضف أول التزام وسيظهر هنا مباشرة.</p>
            </CardContent>
          </Card>
        )}
      </section>

      {upcomingObligations.length > 0 ? (
        <section className="xl:max-w-4xl">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">دفعات قريبة</h2>
            <Link href="/obligations"><Button variant="link" className="h-auto p-0">التفاصيل</Button></Link>
          </div>
          <Card className="border-border/60 shadow-sm">
            <CardContent className="divide-y p-0">
              {upcomingObligations.map((obligation) => (
                <div key={obligation.id} className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><Receipt className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{obligation.title}</p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Calendar className="h-3.5 w-3.5" />{formatObligationDueDate(obligation)}</p>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-amber-700"><CurrencyDisplay amount={obligation.amount} fractionDigits={3} /></span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      ) : null}

      {hasFinancialActivity ? (
        <section className="xl:max-w-4xl">
          <h2 className="mb-3 text-lg font-bold">المال باختصار</h2>
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="text-[11px] text-muted-foreground">الرصيد</p><p className="mt-1 text-sm font-bold"><CurrencyDisplay amount={dashboard?.totalBalance ?? 0} fractionDigits={2} /></p></div>
                <div><p className="text-[11px] text-muted-foreground">الدخل</p><p className="mt-1 text-sm font-bold text-emerald-600"><CurrencyDisplay amount={dashboard?.totalIncome ?? 0} fractionDigits={2} /></p></div>
                <div><p className="text-[11px] text-muted-foreground">المصروف</p><p className="mt-1 text-sm font-bold text-red-600"><CurrencyDisplay amount={dashboard?.totalExpenses ?? 0} fractionDigits={2} /></p></div>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {!isLoading && dashboard?.recentTransactions && dashboard.recentTransactions.length > 0 ? (
        <section className="xl:max-w-4xl">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">آخر المعاملات</h2>
            <Link href="/transactions"><Button variant="link" className="h-auto p-0">عرض الكل</Button></Link>
          </div>
          <Card className="border-border/60 shadow-sm">
            <CardContent className="divide-y p-0">
              {dashboard.recentTransactions.slice(0, 3).map((transaction) => (
                <div key={transaction.id} className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-lg">{transaction.categoryIcon || "📝"}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{transaction.categoryName || "معاملة"}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{normalizeArabicText(transaction.note)} {transaction.date ? `· ${formatRelativeArabicDate(transaction.date)}` : ""}</p>
                  </div>
                  <span className={cn("shrink-0 text-sm font-bold", transaction.type === "income" ? "text-emerald-600" : "text-red-600")}>
                    {transaction.type === "income" ? "+" : "-"}<CurrencyDisplay amount={transaction.amount} fractionDigits={2} />
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
