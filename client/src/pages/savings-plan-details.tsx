import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { cn } from "@/lib/utils";
import { useTransactions, useWallets } from "@/lib/hooks";
import { useRoute, useLocation } from "wouter";
import { useMemo } from "react";
import { ArrowRight, ChevronLeft, Sparkles } from "lucide-react";
import { getSavingsDistributionLabel, savingsPlans } from "@/lib/savings-plans";
import { buildSavingsPlanAnalysis } from "@/lib/savings-plan-analysis";

export default function SavingsPlanDetails() {
  const [location, setLocation] = useLocation();
  const [, params] = useRoute("/financial-plans/:id");
  const planId = params?.id ?? "";

  const { data: transactions = [] } = useTransactions();
  const { data: wallets = [] } = useWallets();

  const plan = savingsPlans.find((item) => item.id === planId) ?? null;

  const searchParams = useMemo(() => {
    const queryStartIndex = location.indexOf("?");
    return new URLSearchParams(queryStartIndex >= 0 ? location.slice(queryStartIndex) : "");
  }, [location]);

  const planYearsParam = Number(searchParams.get("years"));
  const planYears: 3 | 5 | 10 = planYearsParam === 3 || planYearsParam === 10 ? planYearsParam : 5;

  const analysis = useMemo(() => buildSavingsPlanAnalysis({
    transactions,
    wallets,
    manualIncome: searchParams.get("income"),
    manualNeeds: searchParams.get("needs"),
    manualWants: searchParams.get("wants"),
    manualFixedObligations: searchParams.get("fixed"),
    targetAmount: searchParams.get("target"),
    planYears,
  }), [planYears, searchParams, transactions, wallets]);

  const planCard = analysis.planCards.find((item) => item.plan.id === planId) ?? null;
  const effectiveIncome = analysis.effectiveIncome;
  const lastMonthExpenses = analysis.lastMonthExpenses;
  const analysisWindowLabel = analysis.analysisWindowLabel;
  const transitionPlan = analysis.transitionPlan;
  const monthlySavingsAmount = planCard?.monthlySavingsAmount ?? 0;
  const projectedSavings = monthlySavingsAmount * planYears * 12;
  const projectedBalance = planCard?.projectedBalance ?? analysis.totalBalance;
  const investmentProjection = planCard?.investmentProjection ?? analysis.totalBalance;
  const currentSavings = analysis.currentSavings;
  const savingsGap = Math.max(monthlySavingsAmount - Math.max(currentSavings, 0), 0);
  const planFitTone = currentSavings < 0
    ? "text-red-700"
    : savingsGap === 0
      ? "text-emerald-700"
      : "text-amber-700";

  if (!plan) {
    return (
      <div className="app-page" dir="rtl">
        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={() => setLocation("/financial-plans?tab=plans&restoreScroll=1")}>عودة</Button>
        </div>
        <div className="mt-6 text-center text-sm text-muted-foreground">الخطة غير موجودة</div>
      </div>
    );
  }

  return (
    <div className="app-page" dir="rtl">
      <div className="flex flex-row-reverse items-center justify-between gap-3 text-right">
        <Button variant="outline" className="rounded-xl" onClick={() => setLocation("/financial-plans?tab=plans&restoreScroll=1")}>عودة</Button>
        <div className="min-w-0 flex-1 text-center sm:text-right">
          <h1 className="truncate text-lg font-bold sm:text-xl">{plan.title}</h1>
          <p className="truncate text-sm text-muted-foreground">{plan.subtitle}</p>
        </div>
        <ChevronLeft className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden="true" />
      </div>

      <Card className="mt-4 border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-row-reverse items-center justify-center gap-2 text-center sm:justify-start sm:text-right text-base">
            <Sparkles className="h-5 w-5 text-primary" />
            ملخص سريع
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-white p-3">
            <p className="text-xs text-muted-foreground">الادخار الشهري</p>
            <p className="mt-1 text-base font-bold text-emerald-700"><CurrencyDisplay amount={monthlySavingsAmount} fractionDigits={2} /></p>
          </div>
          <div className="rounded-xl border bg-white p-3">
            <p className="text-xs text-muted-foreground">إجمالي الادخار ({planYears} سنوات)</p>
            <p className="mt-1 text-base font-bold text-slate-800"><CurrencyDisplay amount={projectedSavings} fractionDigits={2} /></p>
          </div>
          <div className="rounded-xl border bg-white p-3">
            <p className="text-xs text-muted-foreground">الرصيد المتوقع ({planYears} سنوات)</p>
            <p className="mt-1 text-base font-bold text-primary"><CurrencyDisplay amount={projectedBalance} fractionDigits={2} /></p>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4 border-amber-200 bg-amber-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-center sm:text-right">مدى ملاءمة هذه الخطة لوضعك الحالي</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-white p-3">
            <p className="text-xs text-muted-foreground">ادخارك الحالي شهرياً</p>
            <p className="mt-1 text-base font-bold text-foreground"><CurrencyDisplay amount={currentSavings} fractionDigits={2} /></p>
          </div>
          <div className="rounded-xl border bg-white p-3">
            <p className="text-xs text-muted-foreground">المطلوب لهذه الخطة</p>
            <p className="mt-1 text-base font-bold text-foreground"><CurrencyDisplay amount={monthlySavingsAmount} fractionDigits={2} /></p>
          </div>
          <div className="rounded-xl border bg-white p-3">
            <p className="text-xs text-muted-foreground">فجوة التحسين</p>
            <p className={cn("mt-1 text-base font-bold", planFitTone)}><CurrencyDisplay amount={savingsGap} fractionDigits={2} /></p>
          </div>
          <p className={cn("sm:col-span-3 text-sm", planFitTone)}>
            {currentSavings < 0
              ? "أنت في عجز شهري حالياً، لذلك الأفضل معالجة العجز أولاً ثم الالتزام بهذه الخطة بشكل تدريجي."
              : savingsGap === 0
                ? "مستوى ادخارك الحالي قريب من متطلبات هذه الخطة، وهذا يجعل تطبيقها واقعياً من الآن."
                : "هذه الخطة ممكنة، لكنها تحتاج رفع الادخار الشهري أو خفض بعض المصروفات حتى تصبح مريحة ومستدامة."}
          </p>
          <p className="sm:col-span-3 text-xs text-muted-foreground">أساس التحليل الحالي: {analysisWindowLabel}</p>
        </CardContent>
      </Card>

      <Card className="mt-4 border-violet-200 bg-violet-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-center sm:text-right">خطة انتقال عملية</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-violet-900">
          <div>
            <p className="font-bold">{transitionPlan.title}</p>
            <p className="mt-1 text-violet-800">{transitionPlan.description}</p>
          </div>
          <ul className="space-y-2">
            {transitionPlan.steps.map((step) => (
              <li key={step} className="flex items-start gap-2">
                <ArrowRight className="mt-1 h-4 w-4 text-violet-700" />
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-center sm:text-right">كيف تعمل؟</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl bg-muted/40 p-3 text-sm leading-7 text-slate-700">{plan.description}</div>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {plan.detailedPoints.map((point) => (
                <li key={point} className="flex items-start gap-2">
                  <ArrowRight className="mt-1 h-4 w-4 text-primary" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-center sm:text-right">التوزيع المقترح</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border p-3 text-sm text-muted-foreground">{getSavingsDistributionLabel(plan)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-center sm:text-right">كيف يحسبها النظام؟</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>الدخل المعتمد: <span className="font-bold text-foreground"><CurrencyDisplay amount={effectiveIncome} fractionDigits={2} /></span></p>
            <p>مصروفات آخر 30 يوم: <span className="font-bold text-foreground"><CurrencyDisplay amount={lastMonthExpenses} fractionDigits={2} /></span></p>
            <p>الادخار الشهري: <span className="font-bold text-foreground"><CurrencyDisplay amount={monthlySavingsAmount} fractionDigits={2} /></span></p>
            <p>إجمالي الادخار خلال {planYears} سنوات: <span className="font-bold text-foreground"><CurrencyDisplay amount={projectedSavings} fractionDigits={2} /></span></p>
            <p>الرصيد المتوقع خلال {planYears} سنوات: <span className={cn("font-bold", "text-foreground")}><CurrencyDisplay amount={projectedBalance} fractionDigits={2} /></span></p>
            <p>سيناريو تقديري مع استثمار 8%: <span className="font-bold text-foreground"><CurrencyDisplay amount={investmentProjection} fractionDigits={2} /></span></p>
            {analysis.validationMessages.map((message) => (
              <p key={message} className="text-red-700">{message}</p>
            ))}
            {analysis.infoMessages.map((message) => (
              <p key={message} className="text-sky-700">{message}</p>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
