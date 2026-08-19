import { Calendar, Check, ChevronLeft, CircleAlert, Clock3, ListChecks, Loader2, Plus, Receipt, Settings, Sparkles, WalletCards, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { useMemo, useState } from "react";
import { cn, formatObligationDueDate, formatRelativeArabicDate, getUpcomingObligations, normalizeArabicText } from "@/lib/utils";
import { Link } from "wouter";
import { useCommitments, useDashboard, useDashboardSections, useObligations, useUpdateCommitmentStatus, useUser } from "@/lib/hooks";
import type { Commitment } from "@shared/schema";
import { DEFAULT_DASHBOARD_SECTIONS, type DashboardSectionKey } from "@shared/dashboard-sections";
import InsightsPanel from "@/components/insights-panel";
import QuickCommitment from "@/components/quick-commitment";
import { useToast } from "@/hooks/use-toast";

type PriorityFilter = "all" | "overdue" | "today" | "week";

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
  const { toast } = useToast();
  const { data: user } = useUser();
  const { data: dashboard, isLoading } = useDashboard();
  const { data: obligations, isLoading: isLoadingObligations } = useObligations();
  const { data: commitments = [], isLoading: isLoadingCommitments } = useCommitments();
  const { data: configuredDashboardSections } = useDashboardSections(Boolean(user));
  const updateCommitmentStatus = useUpdateCommitmentStatus();
  const [showQuickCommitment, setShowQuickCommitment] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [completingCommitmentId, setCompletingCommitmentId] = useState<number | null>(null);
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
  const overdueCount = evaluatedCommitments.filter(({ timing }) => timing.tone === "danger").length;
  const todayCount = evaluatedCommitments.filter(({ timing }) => timing.tone === "warning").length;
  const weekCount = evaluatedCommitments.filter(({ timing }) => timing.daysLeft >= 0 && timing.daysLeft <= 7).length;
  const priorityCommitments = useMemo(() => {
    const filtered = evaluatedCommitments.filter(({ timing }) => {
      if (priorityFilter === "overdue") return timing.tone === "danger";
      if (priorityFilter === "today") return timing.daysLeft === 0;
      if (priorityFilter === "week") return timing.daysLeft >= 0 && timing.daysLeft <= 7;
      return true;
    });

    return filtered.slice(0, 5);
  }, [evaluatedCommitments, priorityFilter]);
  const upcomingObligations = getUpcomingObligations(obligations, 3);
  const hasFinancialActivity = (dashboard?.recentTransactions?.length ?? 0) > 0
    || (dashboard?.totalBalance ?? 0) !== 0
    || (dashboard?.totalIncome ?? 0) !== 0
    || (dashboard?.totalExpenses ?? 0) !== 0;
  const isLoadingImportant = isLoadingCommitments || isLoadingObligations;
  const dashboardSections = configuredDashboardSections ?? DEFAULT_DASHBOARD_SECTIONS.map((section, position) => ({
    ...section,
    isEnabled: true,
    position,
    updatedAt: null,
  }));
  const dashboardSectionMap = new Map(dashboardSections.map((section) => [section.key, section]));
  const isDashboardSectionEnabled = (key: DashboardSectionKey) => dashboardSectionMap.get(key)?.isEnabled ?? true;
  const dashboardSectionOrder = (key: DashboardSectionKey) => (dashboardSectionMap.get(key)?.position ?? 0) + 1;

  const openQuickCommitment = () => {
    setShowQuickCommitment(true);
    window.requestAnimationFrame(() => {
      document.getElementById("quick-commitment")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const openAddTransaction = () => {
    window.dispatchEvent(new CustomEvent("open-add-transaction", { detail: { type: "expense" } }));
  };

  const completeCommitment = async (commitment: Commitment) => {
    if (updateCommitmentStatus.isPending) return;

    setCompletingCommitmentId(commitment.id);
    try {
      await updateCommitmentStatus.mutateAsync({ id: commitment.id, status: "completed" });
      toast({ title: "أحسنت! تم إنجاز الالتزام", description: commitment.title });
    } catch (error) {
      toast({
        title: "تعذر تحديث الالتزام",
        description: error instanceof Error ? error.message : "يرجى المحاولة مرة أخرى",
        variant: "destructive",
      });
    } finally {
      setCompletingCommitmentId(null);
    }
  };

  const priorityFilters: Array<{ value: PriorityFilter; label: string; count: number }> = [
    { value: "all", label: "الكل", count: activeCommitments.length },
    { value: "overdue", label: "متأخر", count: overdueCount },
    { value: "today", label: "اليوم", count: todayCount },
    { value: "week", label: "هذا الأسبوع", count: weekCount },
  ];

  return (
    <div className="animate-in fade-in flex flex-col gap-5 px-1 py-4 pb-24 duration-300 sm:gap-6 sm:px-2 sm:py-6 xl:px-0 xl:py-8" dir="rtl">
      <header className="flex items-center justify-between gap-4" style={{ order: 0 }}>
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

      {isDashboardSectionEnabled("focus_summary") ? <Card className="overflow-hidden border-none bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-xl" style={{ order: dashboardSectionOrder("focus_summary") }}>
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

            <div className="mt-5 grid gap-2 sm:flex sm:flex-wrap">
              <Button type="button" variant="secondary" className="h-12 rounded-xl font-bold text-primary" onClick={openQuickCommitment}>
                <Plus className="h-5 w-5" />
                إضافة التزام سريع
              </Button>
              <Button type="button" variant="outline" className="h-12 rounded-xl border-white/30 bg-white/10 font-bold text-white hover:bg-white/20 hover:text-white" onClick={openAddTransaction}>
                <WalletCards className="h-5 w-5" />
                تسجيل معاملة
              </Button>
            </div>
          </div>
        </CardContent>
      </Card> : null}

      {isDashboardSectionEnabled("focus_summary") && showQuickCommitment ? (
        <section id="quick-commitment" className="animate-in slide-in-from-top-2 xl:max-w-4xl" style={{ order: dashboardSectionOrder("focus_summary") }}>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-primary">اكتب التزامك كما تفكر فيه</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowQuickCommitment(false)}>
              <X className="h-4 w-4" />
              إغلاق
            </Button>
          </div>
          <QuickCommitment />
        </section>
      ) : null}

      {isDashboardSectionEnabled("weekly_insights") ? (
        <div style={{ order: dashboardSectionOrder("weekly_insights") }}><InsightsPanel /></div>
      ) : null}

      {isDashboardSectionEnabled("priorities") ? <section className="xl:max-w-4xl" style={{ order: dashboardSectionOrder("priorities") }}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">الأولوية الآن</h2>
            <p className="text-sm text-muted-foreground">الأقرب أولاً، ثم بقية التزاماتك</p>
          </div>
          {activeCommitments.length > 0 ? (
            <Link href="/commitments"><Button variant="link" className="h-auto p-0">عرض الكل</Button></Link>
          ) : null}
        </div>

        {activeCommitments.length > 0 ? (
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="تصفية الأولويات">
            {priorityFilters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                aria-pressed={priorityFilter === filter.value}
                onClick={() => setPriorityFilter(filter.value)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold transition-colors",
                  priorityFilter === filter.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                <span>{filter.label}</span>
                <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", priorityFilter === filter.value ? "bg-white/20" : "bg-muted")}>{filter.count}</span>
              </button>
            ))}
          </div>
        ) : null}

        {isLoadingImportant ? (
          <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>
        ) : priorityCommitments.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {priorityCommitments.map(({ commitment, timing }) => (
              <Card key={commitment.id} className={cn(
                "border-border/60 shadow-sm transition-colors hover:bg-muted/30",
                timing.tone === "danger" && "border-red-200 bg-red-50/60",
                timing.tone === "warning" && "border-amber-200 bg-amber-50/60",
              )}>
                <CardContent className="flex items-center gap-2 p-3 sm:gap-3 sm:p-4">
                  <Link href={`/commitments/${commitment.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
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
                  </Link>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-10 shrink-0 rounded-xl border-emerald-200 bg-emerald-50 px-3 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
                    disabled={updateCommitmentStatus.isPending}
                    onClick={() => completeCommitment(commitment)}
                    aria-label={`إنهاء ${commitment.title}`}
                  >
                    {completingCommitmentId === commitment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    <span className="hidden sm:inline">تم</span>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="border-dashed bg-muted/20">
            <CardContent className="py-9 text-center">
              <ListChecks className="mx-auto h-9 w-9 text-primary/60" />
              <h3 className="mt-3 font-bold">{activeCommitments.length > 0 ? "لا توجد نتائج في هذا العرض" : "لا توجد التزامات نشطة"}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{activeCommitments.length > 0 ? "جرّب اختيار «الكل» لرؤية بقية التزاماتك." : "أضف أول التزام وسيظهر هنا مباشرة."}</p>
              {activeCommitments.length === 0 ? <Button type="button" variant="link" className="mt-2" onClick={openQuickCommitment}>أضف التزاماً الآن</Button> : null}
            </CardContent>
          </Card>
        )}
      </section> : null}

      {isDashboardSectionEnabled("upcoming_obligations") && upcomingObligations.length > 0 ? (
        <section className="xl:max-w-4xl" style={{ order: dashboardSectionOrder("upcoming_obligations") }}>
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

      {isDashboardSectionEnabled("financial_summary") && hasFinancialActivity ? (
        <section className="xl:max-w-4xl" style={{ order: dashboardSectionOrder("financial_summary") }}>
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

      {isDashboardSectionEnabled("recent_transactions") && !isLoading && dashboard?.recentTransactions && dashboard.recentTransactions.length > 0 ? (
        <section className="xl:max-w-4xl" style={{ order: dashboardSectionOrder("recent_transactions") }}>
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
