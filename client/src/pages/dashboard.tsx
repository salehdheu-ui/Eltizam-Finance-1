import { ArrowDownLeft, ArrowUpRight, Eye, EyeOff, Settings, Loader2, Receipt, Calendar, Wallet, PieChart, ChevronLeft, Sparkles, Goal } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { useEffect, useMemo, useState } from "react";
import { calculateSavingsGoalProgress, calculateSavingsGoalSavedAmount, loadSavingsGoals, type SavingsGoalDraft } from "@/lib/savings-goals";
import { cn, formatCurrency, formatObligationDueDate, formatRelativeArabicDate, getUpcomingObligations, normalizeArabicText } from "@/lib/utils";
import { Link, useLocation } from "wouter";
import { useCategories, useDashboard, useUser, useObligations, useWallets } from "@/lib/hooks";

const categoryColors: Record<string, { icon: string; bg: string }> = {
  "طعام": { icon: "🍔", bg: "bg-orange-100 dark:bg-orange-950" },
  "وقود": { icon: "⛽", bg: "bg-blue-100 dark:bg-blue-950" },
  "إيجار": { icon: "🏠", bg: "bg-indigo-100 dark:bg-indigo-950" },
  "راتب": { icon: "💰", bg: "bg-emerald-100 dark:bg-emerald-950" },
  "صحة": { icon: "💊", bg: "bg-red-100 dark:bg-red-950" },
  "تسوق": { icon: "🛍️", bg: "bg-pink-100 dark:bg-pink-950" },
  "فواتير": { icon: "📄", bg: "bg-yellow-100 dark:bg-yellow-950" },
};

function CurrencyBadgeIcon() {
  return (
    <svg viewBox="0 0 64 64" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
      <path d="M25 10c7.8 0 14.9 3.4 20.4 9.8l-4.6 12.7c-4.5-4.4-9.6-6.6-15-6.6-3.8 0-6.6 1.4-6.6 4 0 3 4.5 6.9 12.5 10.7h24.8l-4.8 8.2H38.9c1.6 1.1 3.5 2.2 5.6 3.2 3.2 1.5 6.8 2.9 10.7 4.1l-4.5 7.8c-7.2-1.7-13.8-4.2-19.3-7.6-4.6-2.7-8.5-6-11.4-9.6H2.5l4.8-8.2h8.5c-0.7-1.4-1.1-2.9-1.1-4.4 0-6.5 4.8-11.3 12.3-11.3 4.4 0 8.8 1.3 13.1 4l1.2-3.5C37.2 17.9 31.5 14 25 14c-9.8 0-17.4 6.4-20.8 17.6H0C3.8 18.2 13 10 25 10Z" />
    </svg>
  );
}

export default function Dashboard() {
  const [showBalance, setShowBalance] = useState(true);
  const [isOnboardingDismissed, setIsOnboardingDismissed] = useState(false);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoalDraft[]>([]);
  const [, setLocation] = useLocation();
  const { data: user } = useUser();
  const { data: dashboard, isLoading } = useDashboard();
  const { data: obligations, isLoading: isLoadingObligations } = useObligations();
  const { data: wallets = [] } = useWallets();
  const { data: categories = [] } = useCategories();
  
  const upcomingObligations = getUpcomingObligations(obligations, 5);
  const hasWallets = wallets.length > 0;
  const hasCategories = categories.length > 0;
  const hasTransactions = (dashboard?.recentTransactions?.length ?? 0) > 0;
  const isInitialLoading = isLoading || isLoadingObligations;
  const totalUpcomingObligations = upcomingObligations.reduce((sum, obligation) => sum + obligation.amount, 0);
  const netBalance = (dashboard?.totalIncome ?? 0) - (dashboard?.totalExpenses ?? 0);
  const onboardingSteps = [
    {
      key: "wallets",
      title: "أضف أول محفظة",
      description: "ابدأ بحساب أو محفظة واحدة ليصبح الرصيد والتسجيل المالي واضحًا.",
      href: "/wallets",
      done: hasWallets,
      icon: Wallet,
    },
    {
      key: "categories",
      title: "أنشئ أقسامك الأساسية",
      description: "قسّم مصروفاتك ودخلك لتقرأ التقارير بسهولة لاحقًا.",
      href: "/categories",
      done: hasCategories,
      icon: PieChart,
    },
  ];
  const onboardingStorageKey = useMemo(() => `dashboard-onboarding-dismissed:${user?.id ?? user?.email ?? "guest"}`, [user?.email, user?.id]);
  const userGuideStorageKey = "eltizam-user-guide-seen";

  useEffect(() => {
    const storedValue = window.localStorage.getItem(onboardingStorageKey);
    setIsOnboardingDismissed(storedValue === "true");
  }, [onboardingStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const hasSeenGuide = window.localStorage.getItem(userGuideStorageKey) === "true";
    if (!hasSeenGuide) {
      setLocation("/user-guide");
    }
  }, [setLocation, userGuideStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncGoals = () => {
      setSavingsGoals(loadSavingsGoals());
    };

    syncGoals();
    window.addEventListener("storage", syncGoals);

    return () => {
      window.removeEventListener("storage", syncGoals);
    };
  }, []);

  const hasCompletedInitialSetup = onboardingSteps.every((step) => step.done);
  const nextStep = onboardingSteps.find((step) => !step.done);
  const shouldShowOnboardingCard = !hasCompletedInitialSetup && !isOnboardingDismissed && !!nextStep;
  const savingsGoalsSummary = useMemo(() => {
    const totalTarget = savingsGoals.reduce((sum, goal) => sum + goal.targetAmount, 0);
    const totalMonthly = savingsGoals.reduce((sum, goal) => sum + goal.monthlyAmount, 0);
    const totalSaved = savingsGoals.reduce((sum, goal) => sum + calculateSavingsGoalSavedAmount(goal, wallets), 0);
    const averageProgress = savingsGoals.length > 0
      ? savingsGoals.reduce((sum, goal) => sum + calculateSavingsGoalProgress(goal, wallets), 0) / savingsGoals.length
      : 0;

    return {
      totalTarget,
      totalMonthly,
      totalSaved,
      averageProgress,
    };
  }, [savingsGoals, wallets]);

  const handleDismissOnboarding = () => {
    window.localStorage.setItem(onboardingStorageKey, "true");
    setIsOnboardingDismissed(true);
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 flex flex-col gap-5 px-1 py-4 pb-24 duration-500 sm:gap-6 sm:px-2 sm:py-6 xl:px-0 xl:py-8" dir="rtl">
      <header className="mb-1 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-sm font-medium text-muted-foreground" data-testid="text-greeting">مرحباً بعودتك،</h1>
          <h2 className="text-xl font-bold sm:text-2xl" data-testid="text-username">{user?.name || "المستخدم"}</h2>
        </div>
        <div className="shrink-0">
          <Link href="/settings">
            <div className="h-11 w-11 bg-primary/10 rounded-full flex items-center justify-center text-primary cursor-pointer hover:bg-primary/20 transition-colors" data-testid="link-settings">
              <Settings className="h-5 w-5" />
            </div>
          </Link>
        </div>
      </header>

      {shouldShowOnboardingCard ? (
        <Card className="border-primary/20 bg-primary/5 shadow-sm overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-primary font-semibold mb-1">خطوتك التالية</p>
                <h3 className="font-bold text-base">{nextStep.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{nextStep.description}</p>
                <Button variant="ghost" size="sm" className="mt-3 h-auto px-0 text-muted-foreground hover:text-foreground" onClick={handleDismissOnboarding}>
                  تخطي
                </Button>
              </div>
              <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <nextStep.icon className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {onboardingSteps.map((step) => (
                <Link key={step.key} href={step.href}>
                  <div className={cn(
                    "rounded-xl border p-3 h-full transition-colors cursor-pointer",
                    step.done ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border/60 bg-background hover:bg-muted/50"
                  )}>
                    <div className="flex items-center justify-between mb-2">
                      <step.icon className="h-4 w-4" />
                      <span className="text-[11px] font-medium">{step.done ? "مكتملة" : "مطلوبة"}</span>
                    </div>
                    <p className="text-xs font-medium leading-5">{step.title}</p>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="relative overflow-hidden border-none bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-xl">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-3xl -mr-10 -mt-10"></div>
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-black/10 rounded-full blur-2xl -ml-5 -mb-5"></div>
        
        <CardContent className="relative z-10 p-4 sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-3 sm:mb-6">
            <span className="text-sm font-medium text-primary-foreground/80">الرصيد الإجمالي</span>
            <button 
              onClick={() => setShowBalance(!showBalance)}
              className="rounded-full bg-white/10 p-2 text-primary-foreground/80 transition-colors hover:text-white"
              data-testid="button-toggle-balance"
            >
              {showBalance ? <Eye className="h-4 w-4 sm:h-5 sm:w-5" /> : <EyeOff className="h-4 w-4 sm:h-5 sm:w-5" />}
            </button>
          </div>
          
          <div className="mb-6 sm:mb-8">
            <h3 className="flex items-baseline gap-2 text-3xl font-black tracking-tight sm:text-4xl" data-testid="text-total-balance">
              {isLoading ? (
                <Loader2 className="h-8 w-8 animate-spin" />
              ) : showBalance ? (
                <CurrencyDisplay amount={dashboard?.totalBalance ?? 0} fractionDigits={2} symbolClassName="text-lg font-medium text-primary-foreground/80" />
              ) : (
                "••••••••"
              )}
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-white/20 pt-4 sm:gap-4">
            <div className="rounded-2xl bg-white/10 p-3 backdrop-blur-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs text-primary-foreground/70">
                  <CurrencyBadgeIcon />
                  الدخل
                </span>
                <div className="rounded-xl bg-white/15 p-2">
                  <ArrowDownLeft className="h-4 w-4 text-green-300 sm:h-5 sm:w-5" strokeWidth={3} />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="break-words text-sm font-semibold sm:text-base" data-testid="text-income">
                  {showBalance ? `+${formatCurrency(dashboard?.totalIncome ?? 0, 2)}` : "••••"}
                </p>
                {showBalance ? (
                  <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-white/15 px-2 text-xs font-bold text-primary-foreground/85">
                    <CurrencyBadgeIcon />
                  </span>
                ) : null}
              </div>
            </div>
            <div className="rounded-2xl bg-white/10 p-3 backdrop-blur-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs text-primary-foreground/70">
                  <CurrencyBadgeIcon />
                  المصروفات
                </span>
                <div className="rounded-xl bg-white/15 p-2">
                  <ArrowUpRight className="h-4 w-4 text-red-300 sm:h-5 sm:w-5" strokeWidth={3} />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="break-words text-sm font-semibold sm:text-base" data-testid="text-expenses">
                  {showBalance ? `-${formatCurrency(dashboard?.totalExpenses ?? 0, 2)}` : "••••"}
                </p>
                {showBalance ? (
                  <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-white/15 px-2 text-xs font-bold text-primary-foreground/85">
                    <CurrencyBadgeIcon />
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {!nextStep && !isInitialLoading ? (
        <Card className="border-border/50 shadow-sm bg-card/80">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <p className="text-sm font-semibold text-primary mb-1">ملخص سريع</p>
                <h3 className="font-bold text-base">وضعك الحالي باختصار</h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-emerald-700">صافي الحركة</span>
                      <div className="rounded-full bg-emerald-100 p-2 text-emerald-700">
                        <ArrowDownLeft className="h-4 w-4" />
                      </div>
                    </div>
                    <p className={cn("text-base font-bold", netBalance >= 0 ? "text-emerald-700" : "text-red-600")}>
                      {netBalance >= 0 ? "+" : "-"}<CurrencyDisplay amount={Math.abs(netBalance)} fractionDigits={2} />
                    </p>
                  </div>

                  <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-amber-700">الالتزامات القريبة</span>
                      <div className="rounded-full bg-amber-100 p-2 text-amber-700">
                        <Receipt className="h-4 w-4" />
                      </div>
                    </div>
                    <p className="text-base font-bold text-amber-700">
                      <CurrencyDisplay amount={totalUpcomingObligations} fractionDigits={2} />
                    </p>
                  </div>

                  <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-sky-700">المحافظ المتاحة</span>
                      <div className="rounded-full bg-sky-100 p-2 text-sky-700">
                        <Wallet className="h-4 w-4" />
                      </div>
                    </div>
                    <p className="text-base font-bold text-sky-700">{wallets.length}</p>
                  </div>

                  <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-violet-700">الأقسام المعرفة</span>
                      <div className="rounded-full bg-violet-100 p-2 text-violet-700">
                        <PieChart className="h-4 w-4" />
                      </div>
                    </div>
                    <p className="text-base font-bold text-violet-700">{categories.length}</p>
                  </div>
                </div>
              </div>
              <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Sparkles className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-emerald-200 bg-emerald-50/70 shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-emerald-700 mb-1">الأهداف الادخارية</p>
              <h3 className="font-bold text-base">متابعة أهدافك من الصفحة الرئيسية</h3>
              <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                <p>عدد الأهداف: <span className="font-bold text-foreground">{savingsGoals.length}</span></p>
                <p>المحفوظ فعلياً: <span className="font-bold text-emerald-700"><CurrencyDisplay amount={savingsGoalsSummary.totalSaved} fractionDigits={2} /></span></p>
                <p>إجمالي الادخار الشهري: <span className="font-bold text-emerald-700"><CurrencyDisplay amount={savingsGoalsSummary.totalMonthly} fractionDigits={2} /></span></p>
                <p>إجمالي المستهدف: <span className="font-bold text-primary"><CurrencyDisplay amount={savingsGoalsSummary.totalTarget} fractionDigits={2} /></span></p>
                <p>متوسط التقدم: <span className="font-bold text-foreground">{savingsGoalsSummary.averageProgress.toFixed(0)}%</span></p>
              </div>
            </div>
            <div className="h-10 w-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <Goal className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
            <Link href="/savings-goals">
              <Button className="w-full sm:w-auto">عرض الأهداف الادخارية</Button>
            </Link>
            <Link href="/financial-plans?tab=plans">
              <Button variant="outline" className="w-full sm:w-auto">إضافة هدف جديد</Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:max-w-4xl">
        <Link href="/wallets">
          <div className="bg-card flex min-h-[128px] flex-col justify-between rounded-2xl border border-border/50 p-3 shadow-sm transition-colors hover:bg-muted/30 cursor-pointer sm:p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="rounded-xl bg-primary/10 p-2">
                <Wallet className="h-4 w-4 text-primary sm:h-5 sm:w-5" />
              </div>
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="space-y-1 text-right">
              <h3 className="font-bold text-sm">المحافظ</h3>
              <p className="text-xs text-muted-foreground">{hasWallets ? `${wallets.length} محفوظة` : "أضف محفظتك الأولى"}</p>
            </div>
          </div>
        </Link>
        <Link href="/categories">
          <div className="bg-card flex min-h-[128px] flex-col justify-between rounded-2xl border border-border/50 p-3 shadow-sm transition-colors hover:bg-muted/30 cursor-pointer sm:p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="rounded-xl bg-primary/10 p-2">
                <PieChart className="h-4 w-4 text-primary sm:h-5 sm:w-5" />
              </div>
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="space-y-1 text-right">
              <h3 className="font-bold text-sm">الأقسام</h3>
              <p className="text-xs text-muted-foreground">{hasCategories ? `${categories.length} قسمًا` : "أنشئ أقسامك الأساسية"}</p>
            </div>
          </div>
        </Link>
        <Link href="/savings-goals">
          <div className="bg-card flex min-h-[128px] flex-col justify-between rounded-2xl border border-border/50 p-3 shadow-sm transition-colors hover:bg-muted/30 cursor-pointer sm:p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="rounded-xl bg-emerald-100 p-2">
                <Goal className="h-4 w-4 text-emerald-700 sm:h-5 sm:w-5" />
              </div>
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="space-y-1 text-right">
              <h3 className="font-bold text-sm">الأهداف الادخارية</h3>
              <p className="text-xs text-muted-foreground">{savingsGoals.length > 0 ? `${savingsGoals.length} أهداف` : "أضف هدفك الأول"}</p>
            </div>
          </div>
        </Link>
      </div>

      <div className="mt-4 xl:max-w-4xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-lg">الالتزامات القادمة</h3>
          <Link href="/obligations">
            <Button variant="link" className="text-primary h-auto p-0 cursor-pointer">عرض الكل</Button>
          </Link>
        </div>

        {isLoadingObligations ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : upcomingObligations.length > 0 ? (
          <Card className="border border-border/50 shadow-sm">
            <CardContent className="p-4">
              <div className="space-y-3">
                {upcomingObligations.map((obligation) => (
                  <div 
                    key={obligation.id} 
                    className="flex flex-col gap-3 rounded-xl bg-muted/30 p-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                        <Receipt className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm">{obligation.title}</h4>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <Calendar className="h-3 w-3" />
                          <span>{formatObligationDueDate(obligation)}</span>
                        </div>
                        <p className="text-[11px] text-amber-600 mt-1">
                          {obligation.daysLeft === 0 ? "اليوم" : obligation.daysLeft === 1 ? "غدًا" : `بعد ${obligation.daysLeft} يوم`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right sm:text-left">
                      <span className="font-bold text-destructive text-sm">
                        <CurrencyDisplay amount={obligation.amount} fractionDigits={3} />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="text-center py-8 bg-muted/20 rounded-2xl border border-dashed border-border/50">
            <Receipt className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground text-sm">لا توجد التزامات قادمة</p>
            <p className="text-xs text-muted-foreground/70 mt-1">أضف التزاماتك المالية لتتبع مواعيد الاستحقاق</p>
            <Link href="/obligations">
              <Button variant="outline" size="sm" className="mt-4">إضافة التزام</Button>
            </Link>
          </div>
        )}
      </div>

      <div className="mt-6 xl:max-w-5xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-lg">أحدث المعاملات</h3>
          <Link href="/transactions">
            <Button variant="link" className="text-primary h-auto p-0 cursor-pointer" data-testid="link-all-transactions">عرض الكل</Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : dashboard?.recentTransactions && dashboard.recentTransactions.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {dashboard.recentTransactions.map((tx) => {
              const catName = tx.categoryName || "أخرى";
              const colors = categoryColors[catName] || { icon: tx.categoryIcon || "📝", bg: "bg-muted" };
              return (
                <div key={tx.id} className="bg-card flex items-center justify-between gap-3 rounded-2xl border border-border/50 p-4 shadow-sm transition-all hover-elevate cursor-pointer" data-testid={`card-transaction-${tx.id}`}>
                  <div className="flex min-w-0 items-center gap-4">
                    <div className={cn("h-12 w-12 rounded-2xl flex items-center justify-center text-xl", colors.bg)}>
                      {tx.categoryIcon || colors.icon}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold">{catName}</h4>
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{normalizeArabicText(tx.note)} {tx.date && `• ${formatRelativeArabicDate(tx.date)}`}</p>
                    </div>
                  </div>
                  <div className={cn(
                    "shrink-0 text-left font-bold text-lg",
                    tx.type === 'income' ? "text-emerald-500" : tx.type === 'expense' ? "text-red-500" : ""
                  )}>
                    {tx.type === 'income' ? '+' : '-'}<CurrencyDisplay amount={tx.amount} fractionDigits={2} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-10 bg-muted/20 rounded-2xl border border-dashed border-border/50">
            <p className="text-muted-foreground font-medium">لا توجد معاملات بعد</p>
            <p className="text-xs text-muted-foreground/70 mt-1">ابدأ بمحفظة، ثم قسم، ثم أضف معاملتك الأولى من زر + أسفل الشاشة</p>
            <div className="flex items-center justify-center gap-2 mt-4">
              {!hasWallets ? (
                <Link href="/wallets">
                  <Button variant="outline" size="sm">إضافة محفظة</Button>
                </Link>
              ) : null}
              {!hasCategories ? (
                <Link href="/categories">
                  <Button variant="outline" size="sm">إضافة قسم</Button>
                </Link>
              ) : null}
              {hasWallets && hasCategories ? (
                <Button variant="outline" size="sm" onClick={() => window.dispatchEvent(new CustomEvent("open-add-transaction"))}>إضافة معاملة</Button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
