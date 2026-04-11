import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTransactions, useWallets } from "@/lib/hooks";
import { cn, formatCurrency } from "@/lib/utils";
import { ArrowRight, CheckCircle2, Sparkles, Target, TrendingUp, Wallet } from "lucide-react";
import { getSavingsDistributionLabel, savingsPlans } from "@/lib/savings-plans";
import { buildSavingsPlanAnalysis } from "@/lib/savings-plan-analysis";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function OmaniCurrencySymbol({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 372 200" aria-hidden="true" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M51 88H372L348 132H25L51 88Z" fill="currentColor" />
      <path d="M14 153H338L314 197H-10L14 153Z" fill="currentColor" />
      <path d="M209 29C201 18 187 8 171 4C152 -1 132 0 118 9C100 20 90 43 90 75V88H123V77C123 56 129 44 140 38C149 33 161 33 173 37C186 42 197 51 205 60L209 29Z" fill="currentColor" />
      <path d="M131 88H199C211 101 228 113 249 122C265 129 285 136 311 142H243C222 136 204 128 188 118C165 104 146 90 131 88Z" fill="currentColor" />
    </svg>
  );
}

export default function SavingsPlans() {
  const [location, setLocation] = useLocation();
  const { data: transactions = [] } = useTransactions();
  const { data: wallets = [] } = useWallets();

  const [activeTab, setActiveTab] = useState<"savings" | "plans">(() => {
    if (typeof window === "undefined") {
      return "savings";
    }

    const params = new URLSearchParams(window.location.search);
    return params.get("tab") === "plans" ? "plans" : "savings";
  });
  const [planYears, setPlanYears] = useState<3 | 5 | 10>(5);
  const [targetAmount, setTargetAmount] = useState("");
  const [manualIncome, setManualIncome] = useState("");
  const [manualNeeds, setManualNeeds] = useState("");
  const [manualWants, setManualWants] = useState("");
  const [manualFixedObligations, setManualFixedObligations] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const analysis = useMemo(() => buildSavingsPlanAnalysis({
    transactions,
    wallets,
    manualIncome,
    manualNeeds,
    manualWants,
    manualFixedObligations,
    targetAmount,
    planYears,
  }), [manualFixedObligations, manualIncome, manualNeeds, manualWants, planYears, targetAmount, transactions, wallets]);

  const {
    totalBalance,
    lastMonthIncome,
    effectiveIncome,
    effectiveExpenses,
    currentSavings,
    currentSavingsRate,
    targetNum,
    recommendedPlan,
    recommendedPlanAnalysis,
    planCards,
    improvementGap,
    exampleIncome,
    validationMessages,
    infoMessages,
  } = analysis;

  const selectedPlan = savingsPlans.find((plan) => plan.id === selectedPlanId) ?? recommendedPlan;
  const recommendedPlanCard = planCards.find(({ plan }) => plan.id === recommendedPlan.id) ?? null;

  const renderCurrency = (amount: number) => (
    <span dir="ltr" className="inline-flex items-center gap-1 whitespace-nowrap align-baseline">
      <OmaniCurrencySymbol className="h-[0.9em] w-auto shrink-0" />
      <span>{formatCurrency(amount, 2)}</span>
    </span>
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const savedPlanId = window.localStorage.getItem("eltizam-selected-savings-plan");

    if (savedPlanId) {
      setSelectedPlanId(savedPlanId);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const nextTab = params.get("tab") === "plans" ? "plans" : "savings";

    if (nextTab !== activeTab) {
      setActiveTab(nextTab);
    }

    if (params.get("restoreScroll") === "1") {
      const stored = window.sessionStorage.getItem("eltizam-financial-plans-scroll");
      const storedY = stored ? Number(stored) : NaN;

      if (Number.isFinite(storedY)) {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: storedY, behavior: "auto" });
        });
      }

      window.sessionStorage.removeItem("eltizam-financial-plans-scroll");
      params.delete("restoreScroll");
      const nextSearch = params.toString();
      const nextUrl = `/financial-plans${nextSearch ? `?${nextSearch}` : ""}`;
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [activeTab, location]);

  useEffect(() => {
    if (typeof window === "undefined" || !selectedPlanId) {
      return;
    }

    window.localStorage.setItem("eltizam-selected-savings-plan", selectedPlanId);
  }, [selectedPlanId]);

  const currentNeedsAmount = effectiveIncome > 0 ? Math.max(effectiveExpenses - Math.max(analysis.effectiveWants, 0), 0) : 0;
  const currentWantsAmount = Math.max(analysis.effectiveWants, 0);
  const currentNeedsRate = effectiveIncome > 0 ? currentNeedsAmount / effectiveIncome : 0;
  const currentWantsRate = effectiveIncome > 0 ? currentWantsAmount / effectiveIncome : 0;
  const currentReserveRate = 0;
  const statusTone = currentSavings < 0
    ? {
        title: "تحتاج إلى معالجة العجز أولاً",
        description: "مصروفاتك الحالية أعلى من دخلك، والأولوية الآن هي تقليل النزيف قبل تبني خطة ادخار أقوى.",
        className: "border-red-200 bg-red-50 text-red-800",
        badgeClassName: "bg-red-100 text-red-700",
      }
    : currentSavingsRate >= 0.2
      ? {
          title: "وضعك ممتاز للادخار",
          description: "نسبة الادخار الحالية جيدة وتسمح لك بالالتزام بخطة متوازنة أو أسرع نحو الهدف.",
          className: "border-emerald-200 bg-emerald-50 text-emerald-800",
          badgeClassName: "bg-emerald-100 text-emerald-700",
        }
      : currentSavingsRate >= 0.1
        ? {
            title: "وضعك جيد لكنه يحتاج ضبط بسيط",
            description: "أنت تدخر بالفعل، لكن ما زالت هناك فرصة لرفع الادخار أو إعادة توزيع المصروفات لتحسين النتيجة.",
            className: "border-amber-200 bg-amber-50 text-amber-800",
            badgeClassName: "bg-amber-100 text-amber-700",
          }
        : {
            title: "البداية تحتاج انضباط أكبر",
            description: "الادخار الحالي منخفض مقارنة بالدخل، لذلك الأفضل البدء بخطة مريحة ثم رفع النسبة تدريجياً.",
            className: "border-slate-200 bg-slate-50 text-slate-800",
            badgeClassName: "bg-slate-200 text-slate-700",
          };
  const comparisonItems = [
    {
      key: "needs",
      label: "الاحتياجات",
      currentRate: currentNeedsRate,
      targetRate: recommendedPlan.needsRate,
      currentAmount: currentNeedsAmount,
      targetAmount: effectiveIncome * recommendedPlan.needsRate,
      accentClassName: "text-blue-700",
    },
    {
      key: "wants",
      label: "الرغبات",
      currentRate: currentWantsRate,
      targetRate: recommendedPlan.wantsRate,
      currentAmount: currentWantsAmount,
      targetAmount: effectiveIncome * recommendedPlan.wantsRate,
      accentClassName: "text-amber-700",
    },
    {
      key: "savings",
      label: "الادخار",
      currentRate: Math.max(currentSavingsRate, 0),
      targetRate: recommendedPlan.savingsRate,
      currentAmount: Math.max(currentSavings, 0),
      targetAmount: effectiveIncome * recommendedPlan.savingsRate,
      accentClassName: "text-emerald-700",
    },
    {
      key: "reserve",
      label: "الاحتياطي",
      currentRate: currentReserveRate,
      targetRate: recommendedPlan.reserveRate,
      currentAmount: 0,
      targetAmount: effectiveIncome * recommendedPlan.reserveRate,
      accentClassName: "text-violet-700",
    },
  ];

  const comparisonColorMap: Record<string, string> = {
    "الاحتياجات": "#2563eb",
    "الرغبات": "#d97706",
    "الادخار": "#059669",
    "الاحتياطي": "#7c3aed",
  };

  const comparisonChartData = comparisonItems.map((item) => ({
    name: item.label,
    current: Number(item.currentAmount.toFixed(2)),
    target: Number(item.targetAmount.toFixed(2)),
    color: comparisonColorMap[item.label] ?? "#2563eb",
  }));

  const projectionChartData = [3, 5, 10].map((years) => ({
    years: `${years} سنوات`,
    balance: Number((totalBalance + (effectiveIncome * recommendedPlan.savingsRate * years * 12)).toFixed(2)),
    isActive: years === planYears,
  }));

  return (
    <div className="app-page text-right" dir="rtl">
      <div className="text-center py-2 sm:py-4 space-y-1">
        <h1 className="text-xl font-bold sm:text-2xl">خطط الادخار</h1>
        <p className="text-sm text-muted-foreground sm:text-base">شرح أوضح، مقارنة أذكى، وترشيح تلقائي للخطة الأنسب لك</p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const nextTab = value as "savings" | "plans";
          setActiveTab(nextTab);
          setLocation(`/financial-plans?tab=${nextTab}`);
        }}
        className="space-y-4"
      >
        <TabsList className="grid w-full grid-cols-2 rounded-2xl bg-muted p-1">
          <TabsTrigger value="plans" className="rounded-xl">الخطط</TabsTrigger>
          <TabsTrigger value="savings" className="rounded-xl">الادخار</TabsTrigger>
        </TabsList>

        <TabsContent value="savings" className="space-y-4">
          {validationMessages.length > 0 ? (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="space-y-2 pt-6 text-sm text-red-700">
                {validationMessages.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {infoMessages.length > 0 ? (
            <Card className="border-sky-200 bg-sky-50">
              <CardContent className="space-y-2 pt-6 text-sm text-sky-800">
                {infoMessages.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card className={cn("border", statusTone.className)}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base sm:text-lg flex flex-row-reverse items-center justify-between gap-3 text-right">
                <span>{statusTone.title}</span>
                <span className={cn("rounded-full px-3 py-1 text-xs font-bold", statusTone.badgeClassName)}>
                  {effectiveIncome > 0 ? `${Math.round(currentSavingsRate * 100)}% ادخار` : "بيانات محدودة"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>{statusTone.description}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border bg-white/80 p-3">
                  <p className="text-xs text-muted-foreground">الفائض الشهري الحالي</p>
                  <p className={cn("mt-1 font-bold", currentSavings >= 0 ? "text-emerald-700" : "text-red-700")}>{renderCurrency(currentSavings)}</p>
                </div>
                <div className="rounded-xl border bg-white/80 p-3">
                  <p className="text-xs text-muted-foreground">المطلوب للخطة الموصى بها</p>
                  <p className="mt-1 font-bold text-foreground">{renderCurrency(effectiveIncome * recommendedPlan.savingsRate)}</p>
                </div>
                <div className="rounded-xl border bg-white/80 p-3">
                  <p className="text-xs text-muted-foreground">فجوة التحسين</p>
                  <p className="mt-1 font-bold text-amber-700">{renderCurrency(improvementGap)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base sm:text-lg flex flex-row-reverse items-center justify-center gap-2 text-center">
                <Wallet className="h-5 w-5 text-primary" />
                وضعك المالي الحالي
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-white rounded-xl border">
                <p className="text-xs text-muted-foreground">الرصيد الحالي</p>
                <p className="break-words text-base font-bold text-primary sm:text-lg">{renderCurrency(totalBalance)}</p>
              </div>
              <div className="p-3 bg-white rounded-xl border">
                <p className="text-xs text-muted-foreground">الدخل الشهري المرصود</p>
                <p className="break-words text-base font-bold text-emerald-600 sm:text-lg">{renderCurrency(lastMonthIncome)}</p>
              </div>
              <div className="p-3 bg-white rounded-xl border col-span-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">الادخار الشهري الحالي</span>
                  <span className={cn("font-bold", currentSavings >= 0 ? "text-emerald-600" : "text-red-600")}>{renderCurrency(currentSavings)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base sm:text-lg flex flex-row-reverse items-center justify-center gap-2 text-center">
                <Target className="h-5 w-5 text-primary" />
                بيانات حساب الادخار
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">الدخل الشهري</label>
                  <Input type="text" inputMode="decimal" value={manualIncome} onChange={(e) => setManualIncome(e.target.value)} placeholder={lastMonthIncome ? `${formatCurrency(lastMonthIncome, 2)}` : "مثال: 1200"} dir="rtl" className="app-input text-right" />
                  <p className="text-xs text-muted-foreground">أدخل متوسط ما يدخل لك شهرياً إذا أردت حساباً أدق.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">المصاريف الأساسية</label>
                  <Input type="text" inputMode="decimal" value={manualNeeds} onChange={(e) => setManualNeeds(e.target.value)} placeholder="مثال: 500" dir="rtl" className="app-input text-right" />
                  <p className="text-xs text-muted-foreground">مثل السكن، الفواتير، الطعام، النقل، والتعليم.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">الرغبات والكماليات</label>
                  <Input type="text" inputMode="decimal" value={manualWants} onChange={(e) => setManualWants(e.target.value)} placeholder="مثال: 150" dir="rtl" className="app-input text-right" />
                  <p className="text-xs text-muted-foreground">مثل الترفيه، التسوق غير الضروري، والمطاعم.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">الالتزامات الشهرية الثابتة</label>
                  <Input type="text" inputMode="decimal" value={manualFixedObligations} onChange={(e) => setManualFixedObligations(e.target.value)} placeholder="مثال: 200" dir="rtl" className="app-input text-right" />
                  <p className="text-xs text-muted-foreground">مثل الأقساط، الديون، الاشتراكات، أو أي التزام ثابت.</p>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-sm font-medium">الهدف الادخاري</label>
                  <Input type="text" inputMode="decimal" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} placeholder="مثال: 10000" dir="rtl" className="app-input text-right" />
                  <p className="text-xs text-muted-foreground">
                    أدخل المبلغ الذي تريد الوصول إليه ليحسب النظام أسرع خطة وأقرب خطة واقعية.
                  </p>
                </div>
              </div>

              <div className="flex flex-row-reverse gap-2">
                {[3, 5, 10].map((years) => (
                  <button
                    key={years}
                    onClick={() => setPlanYears(years as 3 | 5 | 10)}
                    className={cn(
                      "flex-1 py-3 rounded-xl text-sm font-bold transition-all",
                      planYears === years ? "bg-primary text-primary-foreground shadow-lg" : "bg-muted text-muted-foreground hover:bg-muted/80"
                    )}
                  >
                    {years} سنوات
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base sm:text-lg flex flex-row-reverse items-center justify-center gap-2 text-center">
                <Sparkles className="h-5 w-5 text-amber-600" />
                ملخص سريع
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border bg-white p-3">
                <p className="text-xs text-muted-foreground">الدخل المعتمد</p>
                <p className="break-words text-base font-bold text-slate-800">{renderCurrency(effectiveIncome)}</p>
              </div>
              <div className="rounded-xl border bg-white p-3">
                <p className="text-xs text-muted-foreground">المصاريف المعتمدة</p>
                <p className="break-words text-base font-bold text-slate-800">{renderCurrency(effectiveExpenses)}</p>
              </div>
              <div className="rounded-xl border bg-white p-3">
                <p className="text-xs text-muted-foreground">نسبة الادخار الحالية</p>
                <p className={cn("break-words text-base font-bold", currentSavingsRate >= 0.2 ? "text-emerald-700" : currentSavingsRate >= 0.1 ? "text-amber-700" : "text-slate-800")}>
                  {effectiveIncome > 0 ? `${Math.round(currentSavingsRate * 100)}%` : "-"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLocation("/financial-plans?tab=plans")}
                className="sm:col-span-3 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800"
              >
                استعرض الخطط المقترحة
              </button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base sm:text-lg flex flex-row-reverse items-center justify-center gap-2 text-center">
                <Sparkles className="h-5 w-5 text-primary" />
                مقارنة سريعة بين أفضل الخيارات
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              {planCards.slice(0, 3).map(({ plan, compatibility, monthlySavingsAmount, monthsToGoal, smartBadge, isRecommended }) => (
                <div key={plan.id} className={cn("rounded-xl border p-4", isRecommended ? "border-emerald-300 bg-emerald-50" : "bg-white")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-foreground">{plan.title}</p>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700">{smartBadge}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{getSavingsDistributionLabel(plan)}</p>
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">التوافق</span>
                      <span className="font-bold text-blue-700">{compatibility}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className={cn("h-full rounded-full", isRecommended ? "bg-emerald-500" : "bg-blue-500")} style={{ width: `${compatibility}%` }} />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">الادخار الشهري</span>
                      <span className="font-medium">{renderCurrency(monthlySavingsAmount)}</span>
                    </div>
                    {targetNum > totalBalance ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">الوصول للهدف</span>
                        <span className="font-medium">{monthsToGoal ? `${monthsToGoal} شهر` : "غير متاح حالياً"}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="rounded-xl border bg-white p-4">
            <div className="flex flex-col gap-1 sm:flex-row-reverse sm:items-center sm:justify-between">
              <p className="font-medium text-foreground">مقارنة وضعك الحالي بالخطة المقترحة</p>
              <p className="text-xs text-muted-foreground">حتى تعرف أين تحتاج التعديل تحديداً</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {comparisonItems.map((item) => {
                const rateDifference = item.targetRate - item.currentRate;
                const amountDifference = item.targetAmount - item.currentAmount;
                const differenceLabel = amountDifference > 0
                  ? `تحتاج زيادة ${renderCurrency(amountDifference)}`
                  : amountDifference < 0
                    ? `يمكنك خفض ${renderCurrency(Math.abs(amountDifference))}`
                    : "أنت قريب جداً من النسبة المقترحة";

                return (
                  <div key={item.key} className="rounded-xl border bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className={cn("font-bold", item.accentClassName)}>{item.label}</p>
                      <span className="text-xs text-muted-foreground">
                        الآن {Math.round(item.currentRate * 100)}% / المستهدف {Math.round(item.targetRate * 100)}%
                      </span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                      <div className={cn("h-full rounded-full", item.accentClassName.replace("text", "bg"))} style={{ width: `${Math.min(Math.max(item.currentRate * 100, 0), 100)}%` }} />
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className={cn("h-full rounded-full opacity-70", item.accentClassName.replace("text", "bg"))} style={{ width: `${Math.min(Math.max(item.targetRate * 100, 0), 100)}%` }} />
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">الوضع الحالي</span>
                      <span className="font-medium">{renderCurrency(item.currentAmount)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">المستهدف</span>
                      <span className="font-medium">{renderCurrency(item.targetAmount)}</span>
                    </div>
                    <p className={cn("mt-3 text-sm font-medium", rateDifference > 0 ? "text-amber-700" : rateDifference < 0 ? "text-sky-700" : "text-emerald-700")}>
                      {differenceLabel}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base sm:text-lg flex flex-row-reverse items-center justify-center gap-2 text-center">
                <TrendingUp className="h-5 w-5 text-primary" />
                عرض بصري للوضع الحالي مقابل المستهدف
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="h-80 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparisonChartData} barGap={8}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value: number) => formatCurrency(Number(value), 2)} />
                    <Bar dataKey="current" name="الحالي" radius={[8, 8, 0, 0]} fill="#94a3b8" />
                    <Bar dataKey="target" name="المستهدف" radius={[8, 8, 0, 0]}>
                      {comparisonChartData.map((entry, index) => (
                        <Cell key={`${entry.name}-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:grid-cols-4">
                <div className="rounded-lg bg-slate-50 p-3 text-center">الرمادي: الوضع الحالي</div>
                <div className="rounded-lg bg-blue-50 p-3 text-center text-blue-700">الأزرق: الاحتياجات المستهدفة</div>
                <div className="rounded-lg bg-amber-50 p-3 text-center text-amber-700">البرتقالي: الرغبات المستهدفة</div>
                <div className="rounded-lg bg-emerald-50 p-3 text-center text-emerald-700">الأخضر/البنفسجي: الادخار والاحتياطي</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base sm:text-lg flex flex-row-reverse items-center justify-center gap-2 text-center">
                <Target className="h-5 w-5 text-primary" />
                كيف تنمو الخطة الموصى بها عبر الزمن؟
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {projectionChartData.map((item) => (
                  <div key={item.years} className={cn("rounded-xl border p-3", item.isActive ? "border-primary bg-primary/5" : "bg-white")}>
                    <p className="text-xs text-muted-foreground">{item.years}</p>
                    <p className="mt-1 font-bold text-foreground">{renderCurrency(item.balance)}</p>
                  </div>
                ))}
              </div>
              <div className="h-72 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={projectionChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="years" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value: number) => formatCurrency(Number(value), 2)} />
                    <Bar dataKey="balance" name="الرصيد المتوقع" radius={[8, 8, 0, 0]}>
                      {projectionChartData.map((entry, index) => (
                        <Cell key={`${entry.years}-${index}`} fill={entry.isActive ? "#059669" : "#93c5fd"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-muted-foreground">
                هذا العرض يوضح الرصيد المتوقع للخطة الموصى بها عبر ثلاث مدد زمنية، مع تمييز المدة المختارة حالياً.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plans" className="space-y-4">
          {validationMessages.length > 0 ? (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="space-y-2 pt-6 text-sm text-red-700">
                {validationMessages.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setLocation("/financial-plans?tab=savings")}
              className="order-1 rounded-xl border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              تعديل البيانات
            </button>
            <p className="order-2 text-sm text-muted-foreground">بإمكانك تعديل البيانات من تبويب الادخار لتحسين الترشيح.</p>
          </div>

          <Card className="bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base sm:text-lg flex flex-row-reverse items-center justify-center gap-2 text-center">
                <Sparkles className="h-5 w-5 text-emerald-600" />
                الخطة الأنسب لك الآن
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl border bg-white p-4">
                <div className="flex flex-col gap-3 sm:flex-row-reverse sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-lg font-bold text-emerald-700">{recommendedPlan.title}</p>
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">{recommendedPlanCard?.smartBadge ?? "الخطة الأنسب حالياً"}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{recommendedPlan.subtitle}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-fit rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">موصى بها</div>
                    <div className="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                      توافق {recommendedPlanAnalysis?.compatibility ?? 50}%
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-sm text-slate-700">{recommendedPlan.description}</p>
                <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
                  <p className="font-medium">لماذا رشحها لك النظام؟</p>
                  <ul className="mt-2 space-y-2 text-emerald-700">
                    {(recommendedPlanAnalysis?.reasons ?? []).map((reason) => (
                      <li key={reason} dir="ltr" className="flex w-full flex-row-reverse items-start justify-end gap-2"><ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><span className="flex-1 text-right">{reason}</span></li>
                    ))}
                  </ul>
                </div>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                  <li dir="ltr" className="flex w-full flex-row-reverse items-start justify-end gap-2"><ArrowRight className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" /><span className="flex-1 text-right">الادخار المقترح شهرياً: {renderCurrency(effectiveIncome * recommendedPlan.savingsRate)}</span></li>
                  <li dir="ltr" className="flex w-full flex-row-reverse items-start justify-end gap-2"><ArrowRight className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" /><span className="flex-1 text-right">الزيادة المطلوبة عن وضعك الحالي: {renderCurrency(improvementGap)} شهرياً</span></li>
                  <li dir="ltr" className="flex w-full flex-row-reverse items-start justify-end gap-2"><ArrowRight className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" /><span className="flex-1 text-right">توزيع الخطة: {getSavingsDistributionLabel(recommendedPlan)}</span></li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {selectedPlan ? (
            <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-emerald-50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base sm:text-lg flex flex-row-reverse items-center justify-center gap-2 text-center">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  خطتك المعتمدة حالياً
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-center sm:justify-between">
                  <div>
                    <p className="font-bold text-primary">{selectedPlan.title}</p>
                    <p className="text-sm text-muted-foreground">{selectedPlan.subtitle}</p>
                  </div>
                  <span className="w-fit rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">تم اعتمادها</span>
                </div>
                <p className="text-sm text-slate-700">{selectedPlan.description}</p>
                <div className="rounded-xl bg-white/80 p-3 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">التوزيع المعتمد: </span>
                  {getSavingsDistributionLabel(selectedPlan)}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base sm:text-lg flex flex-row-reverse items-center justify-center gap-2 text-center">
                <Sparkles className="h-5 w-5 text-primary" />
                مقارنة سريعة بين أفضل الخيارات
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              {planCards.slice(0, 3).map(({ plan, compatibility, monthlySavingsAmount, monthsToGoal, smartBadge, isRecommended }) => (
                <div key={plan.id} className={cn("rounded-xl border p-4", isRecommended ? "border-emerald-300 bg-emerald-50" : "bg-white")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-foreground">{plan.title}</p>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700">{smartBadge}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{getSavingsDistributionLabel(plan)}</p>
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">التوافق</span>
                      <span className="font-bold text-blue-700">{compatibility}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className={cn("h-full rounded-full", isRecommended ? "bg-emerald-500" : "bg-blue-500")} style={{ width: `${compatibility}%` }} />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">الادخار الشهري</span>
                      <span className="font-medium">{renderCurrency(monthlySavingsAmount)}</span>
                    </div>
                    {targetNum > totalBalance ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">الوصول للهدف</span>
                        <span className="font-medium">{monthsToGoal ? `${monthsToGoal} شهر` : "غير متاح حالياً"}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-4">
            {planCards.map(({ plan, rank, compatibility, reasons, monthlySavingsAmount, monthlyNeedsAmount, monthlyWantsAmount, monthlyReserveAmount, projectedBalance, investmentProjection, monthsToGoal, smartBadge, isRecommended }) => (
              <Card key={plan.id} className={cn("overflow-hidden", isRecommended ? "border-emerald-400 shadow-lg ring-2 ring-emerald-200" : "", selectedPlanId === plan.id ? "border-primary shadow-md ring-2 ring-primary/20" : "") }>
                {isRecommended ? <div className="bg-gradient-to-l from-emerald-500 to-teal-500 px-4 py-2 text-center text-sm font-bold text-white">هذه الخطة هي الأنسب لك الآن بناءً على بياناتك الحالية</div> : null}
                {selectedPlanId === plan.id ? <div className="bg-gradient-to-l from-primary to-blue-600 px-4 py-2 text-center text-sm font-bold text-white">أنت تعتمد هذه الخطة حالياً</div> : null}
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-col gap-3 text-base sm:flex-row-reverse sm:items-center sm:justify-between sm:text-lg">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{plan.title}</span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (typeof window !== "undefined") {
                              window.sessionStorage.setItem("eltizam-financial-plans-scroll", String(window.scrollY));
                            }
                            const search = new URLSearchParams();
                            search.set("tab", "plans");
                            search.set("income", manualIncome);
                            search.set("needs", manualNeeds);
                            search.set("wants", manualWants);
                            search.set("fixed", manualFixedObligations);
                            search.set("target", targetAmount);
                            search.set("years", String(planYears));
                            setLocation(`/financial-plans/${plan.id}?${search.toString()}`);
                          }}
                          className="rounded-full border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          aria-label={`شرح مفصل لخطة ${plan.title}`}
                        >
                          تفاصيل الخطة
                        </button>
                      </div>
                      <p className="mt-1 text-sm font-normal text-muted-foreground">{plan.subtitle}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">ترتيب #{rank}</span>
                      <span className="w-fit rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">توافق {compatibility}%</span>
                      <span className="w-fit rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">{smartBadge}</span>
                      {isRecommended ? <span className="w-fit rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">الأنسب لك</span> : null}
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-slate-700">{plan.description}</p>
                  <div className="rounded-xl bg-primary/5 p-3 text-sm">
                    <p className="font-medium text-foreground">لماذا حصلت هذه الخطة على هذا الترتيب؟</p>
                    <ul className="mt-2 space-y-2 text-muted-foreground">
                      {reasons.map((reason) => (
                        <li key={reason} dir="ltr" className="flex w-full flex-row-reverse items-start justify-end gap-2"><ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span className="flex-1 text-right">{reason}</span></li>
                      ))}
                    </ul>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">الادخار</p><p className="font-bold text-emerald-600">{renderCurrency(monthlySavingsAmount)}</p></div>
                    <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">الاحتياجات</p><p className="font-bold text-blue-600">{renderCurrency(monthlyNeedsAmount)}</p></div>
                    <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">الرغبات</p><p className="font-bold text-amber-600">{renderCurrency(monthlyWantsAmount)}</p></div>
                    <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">الاحتياطي</p><p className="font-bold text-violet-600">{renderCurrency(monthlyReserveAmount)}</p></div>
                  </div>

                  <div className="rounded-xl border bg-slate-50 p-4">
                    <div className="flex flex-col gap-1 sm:flex-row-reverse sm:items-center sm:justify-between">
                      <p className="font-medium text-foreground">مثال مباشر على تطبيق الخطة</p>
                      <p className="text-xs text-muted-foreground">على دخل شهري قدره {renderCurrency(exampleIncome)}</p>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-lg bg-white p-3 border">
                        <p className="text-xs text-muted-foreground">الاحتياجات</p>
                        <p className="font-bold text-blue-600">{renderCurrency(exampleIncome * plan.needsRate)}</p>
                      </div>
                      <div className="rounded-lg bg-white p-3 border">
                        <p className="text-xs text-muted-foreground">الرغبات</p>
                        <p className="font-bold text-amber-600">{renderCurrency(exampleIncome * plan.wantsRate)}</p>
                      </div>
                      <div className="rounded-lg bg-white p-3 border">
                        <p className="text-xs text-muted-foreground">الادخار</p>
                        <p className="font-bold text-emerald-600">{renderCurrency(exampleIncome * plan.savingsRate)}</p>
                      </div>
                      <div className="rounded-lg bg-white p-3 border">
                        <p className="text-xs text-muted-foreground">الاحتياطي</p>
                        <p className="font-bold text-violet-600">{renderCurrency(exampleIncome * plan.reserveRate)}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs leading-6 text-muted-foreground">
                      هذا المثال يتغير تلقائياً حسب الدخل الذي تدخله أنت، وإذا لم تدخل دخلاً نعرض مثالاً مبسطاً على دخل افتراضي.
                    </p>
                  </div>

                  <div className="rounded-xl border bg-white p-3">
                    <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-foreground">شريط الملاءمة</span>
                      <span className="font-bold text-blue-700">{compatibility}%</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                      <div className={cn("h-full rounded-full transition-all", isRecommended ? "bg-emerald-500" : "bg-blue-500")} style={{ width: `${compatibility}%` }} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-slate-50 p-4 border">
                      <div className="flex items-center gap-2 mb-2"><Target className="h-4 w-4 text-primary" /><span className="font-medium">بعد {planYears} سنوات</span></div>
                      <p className="break-words text-xl font-bold text-slate-800 sm:text-2xl">{renderCurrency(projectedBalance)}</p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 p-4 border border-emerald-200">
                      <div className="flex items-center gap-2 mb-2"><TrendingUp className="h-4 w-4 text-emerald-600" /><span className="font-medium">مع استثمار 8%</span></div>
                      <p className="break-words text-xl font-bold text-emerald-700 sm:text-2xl">{renderCurrency(investmentProjection)}</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-dashed p-4">
                    <p className="font-medium mb-2">متى تختار هذه الخطة؟</p>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      {plan.highlights.map((item) => (
                        <li key={item} dir="ltr" className="flex w-full flex-row-reverse items-start justify-end gap-2"><ArrowRight className="h-4 w-4 shrink-0 text-primary mt-0.5" /><span className="flex-1 text-right">{item}</span></li>
                      ))}
                    </ul>
                    {targetNum > 0 ? <div className="mt-4 rounded-lg bg-primary/5 p-3 text-sm"><span className="font-medium">الوقت التقريبي لتحقيق هدفك:</span> {monthsToGoal ? `${monthsToGoal} شهر` : "أدخل دخلاً شهرياً أو ارفع الادخار"}</div> : null}
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-center sm:justify-between">
                    <button
                      type="button"
                      onClick={() => setSelectedPlanId(plan.id)}
                      className={cn(
                        "w-full rounded-xl px-4 py-3 text-sm font-bold transition-colors sm:w-auto",
                        selectedPlanId === plan.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-slate-900 text-white hover:bg-slate-800"
                      )}
                    >
                      {selectedPlanId === plan.id ? "تم اعتماد هذه الخطة" : "اعتمد هذه الخطة"}
                    </button>
                    {selectedPlanId === plan.id ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPlanId(null);
                          if (typeof window !== "undefined") {
                            window.localStorage.removeItem("eltizam-selected-savings-plan");
                          }
                        }}
                        className="w-full rounded-xl border px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted sm:w-auto"
                      >
                        إلغاء الاعتماد
                      </button>
                    ) : (
                      <p className="text-xs text-muted-foreground">يمكنك اعتماد الخطة المناسبة لك وسيتم تذكرها عند عودتك لاحقاً.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
