import { ArrowDownLeft, ArrowUpRight, Eye, EyeOff, Settings, Loader2, Receipt, Calendar, Wallet, PieChart, ChevronLeft, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { useEffect, useMemo, useState } from "react";
import { cn, formatCurrency, formatObligationDueDate, formatRelativeArabicDate, getUpcomingObligations, normalizeArabicText } from "@/lib/utils";
import { Link } from "wouter";
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

export default function Dashboard() {
  const [showBalance, setShowBalance] = useState(true);
  const [isOnboardingDismissed, setIsOnboardingDismissed] = useState(false);
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

  useEffect(() => {
    const storedValue = window.localStorage.getItem(onboardingStorageKey);
    setIsOnboardingDismissed(storedValue === "true");
  }, [onboardingStorageKey]);

  const hasCompletedInitialSetup = onboardingSteps.every((step) => step.done);
  const nextStep = onboardingSteps.find((step) => !step.done);
  const shouldShowOnboardingCard = !hasCompletedInitialSetup && !isOnboardingDismissed && !!nextStep;

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
        <Link href="/settings">
          <div className="h-11 w-11 bg-primary/10 rounded-full flex items-center justify-center text-primary cursor-pointer hover:bg-primary/20 transition-colors" data-testid="link-settings">
            <Settings className="h-5 w-5" />
          </div>
        </Link>
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
                <span className="text-xs text-primary-foreground/70">الدخل</span>
                <div className="rounded-xl bg-white/15 p-2">
                  <ArrowDownLeft className="h-4 w-4 text-green-300 sm:h-5 sm:w-5" strokeWidth={3} />
                </div>
              </div>
              <p className="break-words text-sm font-semibold sm:text-base" data-testid="text-income">
                {showBalance ? `+${formatCurrency(dashboard?.totalIncome ?? 0, 2)}` : "••••"}
              </p>
            </div>
            <div className="rounded-2xl bg-white/10 p-3 backdrop-blur-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs text-primary-foreground/70">المصروفات</span>
                <div className="rounded-xl bg-white/15 p-2">
                  <ArrowUpRight className="h-4 w-4 text-red-300 sm:h-5 sm:w-5" strokeWidth={3} />
                </div>
              </div>
              <p className="break-words text-sm font-semibold sm:text-base" data-testid="text-expenses">
                {showBalance ? `-${formatCurrency(dashboard?.totalExpenses ?? 0, 2)}` : "••••"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {!nextStep && !isInitialLoading ? (
        <Card className="border-border/50 shadow-sm bg-card/80">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-primary mb-1">ملخص سريع</p>
                <h3 className="font-bold text-base">وضعك الحالي باختصار</h3>
                <div className="space-y-1.5 mt-3 text-sm text-muted-foreground">
                  <p>صافي الحركة: <span className={cn("font-bold", netBalance >= 0 ? "text-emerald-600" : "text-red-600")}>{netBalance >= 0 ? "+" : ""}<CurrencyDisplay amount={Math.abs(netBalance) === netBalance ? netBalance : Math.abs(netBalance)} fractionDigits={2} /></span></p>
                  <p>الالتزامات القريبة: <span className="font-bold text-amber-600"><CurrencyDisplay amount={totalUpcomingObligations} fractionDigits={2} /></span></p>
                  <p>المحافظ المتاحة: <span className="font-bold text-foreground">{wallets.length}</span></p>
                  <p>الأقسام المعرفة: <span className="font-bold text-foreground">{categories.length}</span></p>
                </div>
              </div>
              <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Sparkles className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:max-w-4xl">
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
                    {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount, 2)}
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
