import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTransactions, useWallets } from "@/lib/hooks";
import { cn, formatCurrency, parseNumericInput } from "@/lib/utils";
import { ArrowRight, CheckCircle2, PiggyBank, Sparkles, Target, TrendingUp, Wallet } from "lucide-react";
import {
  calculateCompoundInterest,
  getPlanBadge,
  getSavingsDistributionLabel,
  savingsPlans,
} from "@/lib/savings-plans";

export default function SavingsPlans() {
  const [, setLocation] = useLocation();
  const { data: transactions = [] } = useTransactions();
  const { data: wallets = [] } = useWallets();

  const [activeTab, setActiveTab] = useState<"savings" | "plans">("savings");
  const [planYears, setPlanYears] = useState<3 | 5 | 10>(5);
  const [targetAmount, setTargetAmount] = useState("");
  const [manualIncome, setManualIncome] = useState("");
  const [manualNeeds, setManualNeeds] = useState("");
  const [manualWants, setManualWants] = useState("");
  const [manualFixedObligations, setManualFixedObligations] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const totalBalance = wallets.reduce((sum, wallet) => sum + wallet.balance, 0);

  const lastMonthIncome = transactions
    .filter((transaction) => {
      const transactionDate = new Date(transaction.date);
      const now = new Date();
      const diffDays = (now.getTime() - transactionDate.getTime()) / (1000 * 60 * 60 * 24);
      return transaction.type === "income" && diffDays <= 30;
    })
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  const lastMonthExpenses = transactions
    .filter((transaction) => {
      const transactionDate = new Date(transaction.date);
      const now = new Date();
      const diffDays = (now.getTime() - transactionDate.getTime()) / (1000 * 60 * 60 * 24);
      return transaction.type === "expense" && diffDays <= 30;
    })
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  const parsedManualIncome = parseNumericInput(manualIncome);
  const parsedManualNeeds = parseNumericInput(manualNeeds);
  const parsedManualWants = parseNumericInput(manualWants);
  const parsedFixedObligations = parseNumericInput(manualFixedObligations);
  const parsedTargetAmount = parseNumericInput(targetAmount);

  const effectiveIncome = parsedManualIncome ?? lastMonthIncome;

  const hasManualExpenseBreakdown =
    parsedManualNeeds !== null ||
    parsedManualWants !== null ||
    parsedFixedObligations !== null;

  const effectiveNeeds = parsedManualNeeds ?? 0;
  const effectiveWants = parsedManualWants ?? 0;
  const fixedObligations = parsedFixedObligations ?? 0;

  const effectiveExpenses = hasManualExpenseBreakdown
    ? (effectiveNeeds + effectiveWants + fixedObligations)
    : lastMonthExpenses;

  const currentSavings = effectiveIncome - effectiveExpenses;
  const currentSavingsRate = effectiveIncome > 0 ? currentSavings / effectiveIncome : 0;
  const targetNum = parsedTargetAmount ?? 0;
  const obligationsRatio = effectiveIncome > 0 ? (effectiveNeeds + fixedObligations) / effectiveIncome : 0;
  const wantsRatio = effectiveIncome > 0 ? effectiveWants / effectiveIncome : 0;

  const rankedPlans = useMemo(() => {
    if (effectiveIncome <= 0) {
      return savingsPlans.map((plan, index) => ({
        plan,
        score: savingsPlans.length - index,
        compatibility: 50,
        reasons: ["لا توجد بيانات دخل كافية، لذلك نعرض الخطط من الأبسط إلى الأكثر التزاماً."],
      }));
    }

    return savingsPlans
      .map((plan) => {
        let score = 55;
        const reasons: string[] = [];
        const savingsGap = Math.abs(currentSavingsRate - plan.savingsRate);
        const obligationsGap = Math.abs(obligationsRatio - plan.needsRate);
        const wantsGap = Math.abs(wantsRatio - plan.wantsRate);
        const planTargetSavings = effectiveIncome * plan.savingsRate;
        const improvementGap = Math.max(planTargetSavings - Math.max(currentSavings, 0), 0);
        const isStretch = effectiveIncome > 0 && improvementGap > effectiveIncome * 0.08;

        score += Math.max(0, 28 - savingsGap * 100);
        score += Math.max(0, 16 - obligationsGap * 35);
        score += Math.max(0, 10 - wantsGap * 25);

        if (plan.id === "gradual" && (currentSavingsRate < 0.1 || obligationsRatio > 0.72)) {
          score += 18;
          reasons.push("وضعك الحالي يحتاج بداية مريحة وتدرجاً في رفع الادخار.");
        }

        if (plan.id === "50-30-20" && currentSavingsRate >= 0.15 && obligationsRatio <= 0.58) {
          score += 18;
          reasons.push("توازنك الحالي يسمح بخطة متوازنة بين المصروفات والادخار.");
        }

        if (plan.id === "70-20-10" && fixedObligations > 0 && obligationsRatio >= 0.6) {
          score += 18;
          reasons.push("وجود التزامات شهرية واضحة يجعل هذه الخطة أكثر واقعية واستقراراً.");
        }

        if (plan.id === "babylon" && currentSavingsRate >= 0 && currentSavingsRate < 0.14) {
          score += 12;
          reasons.push("الخطة مناسبة لبناء عادة ادخار ثابتة بدون ضغط كبير.");
        }

        if (targetNum > 0 && plan.savingsRate >= 0.2) {
          score += 8;
          reasons.push("وجود هدف ادخاري واضح يجعل الخطط الأعلى ادخاراً أكثر فاعلية.");
        }

        if (targetNum > 0 && isStretch) {
          score -= 10;
          reasons.push("رغم أنها سريعة نحو الهدف، إلا أنها قد تكون متعبة في وضعك الحالي.");
        }

        if (reasons.length === 0) {
          reasons.push("تقييم الخطة بُني على دخلك واحتياجاتك والتزاماتك الحالية.");
        }

        const compatibility = Math.max(45, Math.min(98, Math.round(score)));

        return {
          plan,
          score,
          compatibility,
          reasons,
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [currentSavings, currentSavingsRate, effectiveIncome, fixedObligations, obligationsRatio, targetNum, wantsRatio]);

  const recommendedPlan = rankedPlans[0]?.plan ?? savingsPlans[0];
  const recommendedPlanAnalysis = rankedPlans[0];
  const fastestGoalPlan = targetNum > totalBalance
    ? rankedPlans
        .filter(({ plan }) => effectiveIncome * plan.savingsRate > 0)
        .sort((a, b) => b.plan.savingsRate - a.plan.savingsRate)[0]?.plan
    : null;
  const selectedPlan = savingsPlans.find((plan) => plan.id === selectedPlanId) ?? null;

  const planCards = rankedPlans.map(({ plan, compatibility, reasons }, index) => {
    const monthlySavingsAmount = effectiveIncome * plan.savingsRate;
    const monthlyNeedsAmount = effectiveIncome * plan.needsRate;
    const monthlyWantsAmount = effectiveIncome * plan.wantsRate;
    const monthlyReserveAmount = effectiveIncome * plan.reserveRate;
    const projectedBalance = totalBalance + monthlySavingsAmount * planYears * 12;
    const investmentProjection = calculateCompoundInterest(totalBalance, monthlySavingsAmount, planYears, 0.08);
    const monthsToGoal = targetNum > totalBalance && monthlySavingsAmount > 0
      ? Math.ceil((targetNum - totalBalance) / monthlySavingsAmount)
      : null;

    return {
      plan,
      rank: index + 1,
      compatibility,
      reasons,
      monthlySavingsAmount,
      monthlyNeedsAmount,
      monthlyWantsAmount,
      monthlyReserveAmount,
      projectedBalance,
      investmentProjection,
      monthsToGoal,
      smartBadge: fastestGoalPlan?.id === plan.id && targetNum > totalBalance ? "الأسرع لهدفك" : getPlanBadge(plan),
      isRecommended: recommendedPlan.id === plan.id,
    };
  });

  const improvementGap = Math.max((recommendedPlan.savingsRate * effectiveIncome) - Math.max(currentSavings, 0), 0);
  const exampleIncome = effectiveIncome > 0 ? effectiveIncome : 1000;

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
    if (typeof window === "undefined" || !selectedPlanId) {
      return;
    }

    window.localStorage.setItem("eltizam-selected-savings-plan", selectedPlanId);
  }, [selectedPlanId]);

  return (
    <div className="app-page" dir="rtl">
      <div className="text-center py-2 sm:py-4 space-y-1">
        <h1 className="text-xl font-bold sm:text-2xl">خطط الادخار</h1>
        <p className="text-sm text-muted-foreground sm:text-base">شرح أوضح، مقارنة أذكى، وترشيح تلقائي للخطة الأنسب لك</p>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "savings" | "plans")} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 rounded-2xl bg-muted p-1">
          <TabsTrigger value="savings" className="rounded-xl">الادخار</TabsTrigger>
          <TabsTrigger value="plans" className="rounded-xl">الخطط</TabsTrigger>
        </TabsList>

        <TabsContent value="savings" className="space-y-4">
          <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                <Wallet className="h-5 w-5 text-primary" />
                وضعك المالي الحالي
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-white rounded-xl border">
                <p className="text-xs text-muted-foreground">الرصيد الحالي</p>
                <p className="break-words text-base font-bold text-primary sm:text-lg">{formatCurrency(totalBalance, 2)} ر.ع</p>
              </div>
              <div className="p-3 bg-white rounded-xl border">
                <p className="text-xs text-muted-foreground">الدخل الشهري المرصود</p>
                <p className="break-words text-base font-bold text-emerald-600 sm:text-lg">{formatCurrency(lastMonthIncome, 2)} ر.ع</p>
              </div>
              <div className="p-3 bg-white rounded-xl border col-span-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">الادخار الشهري الحالي</span>
                  <span className={cn("font-bold", currentSavings >= 0 ? "text-emerald-600" : "text-red-600")}>
                    {formatCurrency(currentSavings, 2)} ر.ع
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                بيانات حساب الادخار
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">الدخل الشهري</label>
                  <Input type="text" inputMode="decimal" value={manualIncome} onChange={(e) => setManualIncome(e.target.value)} placeholder={lastMonthIncome ? `${formatCurrency(lastMonthIncome, 2)}` : "مثال: 1200"} dir="ltr" className="app-input text-left" />
                  <p className="text-xs text-muted-foreground">أدخل متوسط ما يدخل لك شهرياً إذا أردت حساباً أدق.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">المصاريف الأساسية</label>
                  <Input type="text" inputMode="decimal" value={manualNeeds} onChange={(e) => setManualNeeds(e.target.value)} placeholder="مثال: 500" dir="ltr" className="app-input text-left" />
                  <p className="text-xs text-muted-foreground">مثل السكن، الفواتير، الطعام، النقل، والتعليم.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">الرغبات والكماليات</label>
                  <Input type="text" inputMode="decimal" value={manualWants} onChange={(e) => setManualWants(e.target.value)} placeholder="مثال: 150" dir="ltr" className="app-input text-left" />
                  <p className="text-xs text-muted-foreground">مثل الترفيه، التسوق غير الضروري، والمطاعم.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">الالتزامات الشهرية الثابتة</label>
                  <Input type="text" inputMode="decimal" value={manualFixedObligations} onChange={(e) => setManualFixedObligations(e.target.value)} placeholder="مثال: 200" dir="ltr" className="app-input text-left" />
                  <p className="text-xs text-muted-foreground">مثل الأقساط، الديون، الاشتراكات، أو أي التزام ثابت.</p>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-sm font-medium">الهدف الادخاري</label>
                  <Input type="text" inputMode="decimal" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} placeholder="مثال: 10000" dir="ltr" className="app-input text-left" />
                  <p className="text-xs text-muted-foreground">أدخل المبلغ الذي تريد الوصول إليه ليحسب النظام أسرع خطة وأقرب خطة واقعية.</p>
                </div>
              </div>

              <div className="flex gap-2">
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
              <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                <PiggyBank className="h-5 w-5 text-amber-600" />
                ملخص سريع
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border bg-white p-3">
                <p className="text-xs text-muted-foreground">الدخل المعتمد</p>
                <p className="break-words text-base font-bold text-slate-800">{formatCurrency(effectiveIncome, 2)} ر.ع</p>
              </div>
              <div className="rounded-xl border bg-white p-3">
                <p className="text-xs text-muted-foreground">المصاريف المعتمدة</p>
                <p className="break-words text-base font-bold text-slate-800">{formatCurrency(effectiveExpenses, 2)} ر.ع</p>
              </div>
              <div className="rounded-xl border bg-white p-3">
                <p className="text-xs text-muted-foreground">نسبة الادخار الحالية</p>
                <p className={cn("break-words text-base font-bold", currentSavingsRate >= 0.2 ? "text-emerald-700" : currentSavingsRate >= 0.1 ? "text-amber-700" : "text-slate-800")}>
                  {effectiveIncome > 0 ? `${Math.round(currentSavingsRate * 100)}%` : "-"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("plans")}
                className="sm:col-span-3 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800"
              >
                استعرض الخطط المقترحة
              </button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plans" className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">بإمكانك تعديل البيانات من تبويب الادخار لتحسين الترشيح.</p>
            <button
              type="button"
              onClick={() => setActiveTab("savings")}
              className="rounded-xl border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              تعديل البيانات
            </button>
          </div>

      <Card className="bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-emerald-600" />
            الخطة الأنسب لك الآن
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-xl border bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-lg font-bold text-emerald-700">{recommendedPlan.title}</p>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">{fastestGoalPlan?.id === recommendedPlan.id && targetNum > totalBalance ? "الأسرع لهدفك" : getPlanBadge(recommendedPlan)}</span>
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
                  <li key={reason} className="flex items-start gap-2"><ArrowRight className="mt-0.5 h-4 w-4 text-emerald-600" /><span>{reason}</span></li>
                ))}
              </ul>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2"><ArrowRight className="h-4 w-4 text-emerald-600 mt-0.5" /><span>الادخار المقترح شهرياً: {formatCurrency(effectiveIncome * recommendedPlan.savingsRate, 2)} ر.ع</span></li>
              <li className="flex items-start gap-2"><ArrowRight className="h-4 w-4 text-emerald-600 mt-0.5" /><span>الزيادة المطلوبة عن وضعك الحالي: {formatCurrency(improvementGap, 2)} ر.ع شهرياً</span></li>
              <li className="flex items-start gap-2"><ArrowRight className="h-4 w-4 text-emerald-600 mt-0.5" /><span>توزيع الخطة: {getSavingsDistributionLabel(recommendedPlan)}</span></li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {selectedPlan ? (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-emerald-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              خطتك المعتمدة حالياً
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            مقارنة سريعة بين أفضل الخيارات
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {planCards.slice(0, 3).map(({ plan, compatibility, monthlySavingsAmount, monthsToGoal, smartBadge, isRecommended }) => (
            <div key={plan.id} className={cn("rounded-xl border p-4", isRecommended ? "border-emerald-300 bg-emerald-50" : "bg-white") }>
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
                  <span className="font-medium">{formatCurrency(monthlySavingsAmount, 2)} ر.ع</span>
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
              <CardTitle className="flex flex-col gap-3 text-base sm:flex-row sm:items-center sm:justify-between sm:text-lg">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{plan.title}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const search = new URLSearchParams();
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
                    <li key={reason} className="flex items-start gap-2"><ArrowRight className="mt-0.5 h-4 w-4 text-primary" /><span>{reason}</span></li>
                  ))}
                </ul>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">الادخار</p><p className="font-bold text-emerald-600">{formatCurrency(monthlySavingsAmount, 2)} ر.ع</p></div>
                <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">الاحتياجات</p><p className="font-bold text-blue-600">{formatCurrency(monthlyNeedsAmount, 2)} ر.ع</p></div>
                <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">الرغبات</p><p className="font-bold text-amber-600">{formatCurrency(monthlyWantsAmount, 2)} ر.ع</p></div>
                <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">الاحتياطي</p><p className="font-bold text-violet-600">{formatCurrency(monthlyReserveAmount, 2)} ر.ع</p></div>
              </div>

              <div className="rounded-xl border bg-slate-50 p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-medium text-foreground">مثال مباشر على تطبيق الخطة</p>
                  <p className="text-xs text-muted-foreground">على دخل شهري قدره {formatCurrency(exampleIncome, 2)} ر.ع</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg bg-white p-3 border">
                    <p className="text-xs text-muted-foreground">الاحتياجات</p>
                    <p className="font-bold text-blue-600">{formatCurrency(exampleIncome * plan.needsRate, 2)} ر.ع</p>
                  </div>
                  <div className="rounded-lg bg-white p-3 border">
                    <p className="text-xs text-muted-foreground">الرغبات</p>
                    <p className="font-bold text-amber-600">{formatCurrency(exampleIncome * plan.wantsRate, 2)} ر.ع</p>
                  </div>
                  <div className="rounded-lg bg-white p-3 border">
                    <p className="text-xs text-muted-foreground">الادخار</p>
                    <p className="font-bold text-emerald-600">{formatCurrency(exampleIncome * plan.savingsRate, 2)} ر.ع</p>
                  </div>
                  <div className="rounded-lg bg-white p-3 border">
                    <p className="text-xs text-muted-foreground">الاحتياطي</p>
                    <p className="font-bold text-violet-600">{formatCurrency(exampleIncome * plan.reserveRate, 2)} ر.ع</p>
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
                  <div className="flex items-center gap-2 mb-2"><PiggyBank className="h-4 w-4 text-primary" /><span className="font-medium">بعد {planYears} سنوات</span></div>
                  <p className="break-words text-xl font-bold text-slate-800 sm:text-2xl">{formatCurrency(projectedBalance, 2)} ر.ع</p>
                </div>
                <div className="rounded-xl bg-emerald-50 p-4 border border-emerald-200">
                  <div className="flex items-center gap-2 mb-2"><TrendingUp className="h-4 w-4 text-emerald-600" /><span className="font-medium">مع استثمار 8%</span></div>
                  <p className="break-words text-xl font-bold text-emerald-700 sm:text-2xl">{formatCurrency(investmentProjection, 2)} ر.ع</p>
                </div>
              </div>

              <div className="rounded-xl border border-dashed p-4">
                <p className="font-medium mb-2">متى تختار هذه الخطة؟</p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {plan.highlights.map((item) => (
                    <li key={item} className="flex items-start gap-2"><ArrowRight className="h-4 w-4 text-primary mt-0.5" /><span>{item}</span></li>
                  ))}
                </ul>
                {targetNum > 0 ? <div className="mt-4 rounded-lg bg-primary/5 p-3 text-sm"><span className="font-medium">الوقت التقريبي لتحقيق هدفك:</span> {monthsToGoal ? `${monthsToGoal} شهر` : "أدخل دخلاً شهرياً أو ارفع الادخار"}</div> : null}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
