import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useTransactions, useWallets } from "@/lib/hooks";
import { cn, formatCurrency, parseNumericInput } from "@/lib/utils";
import { ArrowRight, PiggyBank, Sparkles, Target, TrendingUp, Wallet } from "lucide-react";

type SavingsPlan = {
  id: string;
  title: string;
  subtitle: string;
  savingsRate: number;
  needsRate: number;
  wantsRate: number;
  reserveRate: number;
  description: string;
  highlights: string[];
};

const savingsPlans: SavingsPlan[] = [
  {
    id: "babylon",
    title: "ادفع لنفسك أولاً",
    subtitle: "مستوحاة من The Richest Man in Babylon",
    savingsRate: 0.1,
    needsRate: 0.7,
    wantsRate: 0.15,
    reserveRate: 0.05,
    description: "احجز 10% من دخلك أولاً قبل أي صرف حتى تبني أصل الادخار والانضباط المالي.",
    highlights: ["بداية ممتازة", "تبني عادة ادخار", "سهلة التطبيق شهرياً"],
  },
  {
    id: "50-30-20",
    title: "خطة 50 / 30 / 20",
    subtitle: "الأشهر عالمياً للتوازن المالي",
    savingsRate: 0.2,
    needsRate: 0.5,
    wantsRate: 0.3,
    reserveRate: 0,
    description: "تقسم دخلك بين الاحتياجات والرغبات والادخار بطريقة متوازنة ومناسبة لمعظم الناس.",
    highlights: ["متوازنة", "واضحة", "مناسبة لمعظم المستخدمين"],
  },
  {
    id: "70-20-10",
    title: "خطة 70 / 20 / 10",
    subtitle: "عملية لمن لديه التزامات واضحة",
    savingsRate: 0.2,
    needsRate: 0.7,
    wantsRate: 0,
    reserveRate: 0.1,
    description: "تناسب من يركز على الاستقرار والاحتياطي مع تقليل الهدر في الكماليات.",
    highlights: ["قوية للأسر", "تعزز الاحتياطي", "تخدم الالتزامات الشهرية"],
  },
  {
    id: "gradual",
    title: "خطة التدرج الذكي",
    subtitle: "ابدأ صغيراً ثم ارفع الادخار تدريجياً",
    savingsRate: 0.15,
    needsRate: 0.65,
    wantsRate: 0.15,
    reserveRate: 0.05,
    description: "مناسبة لمن يريد الدخول في الادخار بشكل مريح ثم زيادة النسبة مع الوقت.",
    highlights: ["مريحة نفسياً", "سهلة الالتزام", "مناسبة بعد التعثر المالي"],
  },
];

function calculateCompoundInterest(principal: number, monthlyContribution: number, years: number, annualRate: number) {
  const monthlyRate = annualRate / 12;
  const totalMonths = years * 12;
  let total = principal;

  for (let i = 0; i < totalMonths; i++) {
    total = total * (1 + monthlyRate) + monthlyContribution;
  }

  return total;
}

export default function SavingsPlans() {
  const { data: transactions = [] } = useTransactions();
  const { data: wallets = [] } = useWallets();

  const [planYears, setPlanYears] = useState<3 | 5 | 10>(5);
  const [targetAmount, setTargetAmount] = useState("");
  const [manualIncome, setManualIncome] = useState("");
  const [manualNeeds, setManualNeeds] = useState("");
  const [manualWants, setManualWants] = useState("");
  const [manualFixedObligations, setManualFixedObligations] = useState("");

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
  const effectiveNeeds = parsedManualNeeds ?? 0;
  const effectiveWants = parsedManualWants ?? 0;
  const fixedObligations = parsedFixedObligations ?? 0;
  const manuallyCalculatedSavings = effectiveIncome - effectiveNeeds - effectiveWants - fixedObligations;
  const currentSavings = parsedManualIncome === null && parsedManualNeeds === null && parsedManualWants === null && parsedFixedObligations === null
    ? lastMonthIncome - lastMonthExpenses
    : manuallyCalculatedSavings;
  const currentSavingsRate = effectiveIncome > 0 ? currentSavings / effectiveIncome : 0;
  const targetNum = parsedTargetAmount ?? 0;

  const recommendedPlan = useMemo(() => {
    if (effectiveIncome <= 0) {
      return savingsPlans[0];
    }

    const obligationsRatio = (effectiveNeeds + fixedObligations) / effectiveIncome;

    if (currentSavingsRate < 0.08 || obligationsRatio > 0.75) {
      return savingsPlans.find((plan) => plan.id === "gradual") ?? savingsPlans[3];
    }

    if (currentSavingsRate >= 0.2 && obligationsRatio <= 0.55) {
      return savingsPlans.find((plan) => plan.id === "50-30-20") ?? savingsPlans[1];
    }

    if (fixedObligations > 0 && obligationsRatio > 0.6) {
      return savingsPlans.find((plan) => plan.id === "70-20-10") ?? savingsPlans[2];
    }

    return savingsPlans.find((plan) => plan.id === "babylon") ?? savingsPlans[0];
  }, [currentSavingsRate, effectiveIncome, effectiveNeeds, fixedObligations]);

  const planCards = savingsPlans.map((plan) => {
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
      monthlySavingsAmount,
      monthlyNeedsAmount,
      monthlyWantsAmount,
      monthlyReserveAmount,
      projectedBalance,
      investmentProjection,
      monthsToGoal,
      isRecommended: recommendedPlan.id === plan.id,
    };
  });

  const improvementGap = Math.max((recommendedPlan.savingsRate * effectiveIncome) - Math.max(currentSavings, 0), 0);

  return (
    <div className="app-page" dir="rtl">
      <div className="text-center py-2 sm:py-4 space-y-1">
        <h1 className="text-xl font-bold sm:text-2xl">خطط الادخار</h1>
        <p className="text-sm text-muted-foreground sm:text-base">4 خطط مشهورة مع قياس الخطة المناسبة لك تلقائياً</p>
      </div>

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
            قياس الخطة المناسبة
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">الدخل الشهري</label>
              <Input type="text" inputMode="decimal" value={manualIncome} onChange={(e) => setManualIncome(e.target.value)} placeholder={lastMonthIncome ? `${formatCurrency(lastMonthIncome, 2)}` : "مثال: 1200"} dir="ltr" className="app-input text-left" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">المصاريف الأساسية</label>
              <Input type="text" inputMode="decimal" value={manualNeeds} onChange={(e) => setManualNeeds(e.target.value)} placeholder="مثال: 500" dir="ltr" className="app-input text-left" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">الرغبات والكماليات</label>
              <Input type="text" inputMode="decimal" value={manualWants} onChange={(e) => setManualWants(e.target.value)} placeholder="مثال: 150" dir="ltr" className="app-input text-left" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">الالتزامات الشهرية الثابتة</label>
              <Input type="text" inputMode="decimal" value={manualFixedObligations} onChange={(e) => setManualFixedObligations(e.target.value)} placeholder="مثال: 200" dir="ltr" className="app-input text-left" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">الهدف الادخاري</label>
              <Input type="text" inputMode="decimal" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} placeholder="مثال: 10000" dir="ltr" className="app-input text-left" />
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
                <p className="text-lg font-bold text-emerald-700">{recommendedPlan.title}</p>
                <p className="text-sm text-muted-foreground">{recommendedPlan.subtitle}</p>
              </div>
              <div className="w-fit rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">موصى بها</div>
            </div>
            <p className="mt-3 text-sm text-slate-700">{recommendedPlan.description}</p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2"><ArrowRight className="h-4 w-4 text-emerald-600 mt-0.5" /><span>الادخار المقترح شهرياً: {formatCurrency(effectiveIncome * recommendedPlan.savingsRate, 2)} ر.ع</span></li>
              <li className="flex items-start gap-2"><ArrowRight className="h-4 w-4 text-emerald-600 mt-0.5" /><span>الزيادة المطلوبة عن وضعك الحالي: {formatCurrency(improvementGap, 2)} ر.ع شهرياً</span></li>
              <li className="flex items-start gap-2"><ArrowRight className="h-4 w-4 text-emerald-600 mt-0.5" /><span>تعتمد التوصية على توازن دخلك مع احتياجاتك والتزاماتك الحالية</span></li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {planCards.map(({ plan, monthlySavingsAmount, monthlyNeedsAmount, monthlyWantsAmount, monthlyReserveAmount, projectedBalance, investmentProjection, monthsToGoal, isRecommended }) => (
          <Card key={plan.id} className={cn(isRecommended ? "border-emerald-400 shadow-lg" : "") }>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-col gap-3 text-base sm:flex-row sm:items-center sm:justify-between sm:text-lg">
                <div className="min-w-0">
                  <span>{plan.title}</span>
                  <p className="mt-1 text-sm font-normal text-muted-foreground">{plan.subtitle}</p>
                </div>
                {isRecommended ? <span className="w-fit rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">الأنسب لك</span> : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-700">{plan.description}</p>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">الادخار</p><p className="font-bold text-emerald-600">{formatCurrency(monthlySavingsAmount, 2)} ر.ع</p></div>
                <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">الاحتياجات</p><p className="font-bold text-blue-600">{formatCurrency(monthlyNeedsAmount, 2)} ر.ع</p></div>
                <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">الرغبات</p><p className="font-bold text-amber-600">{formatCurrency(monthlyWantsAmount, 2)} ر.ع</p></div>
                <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">الاحتياطي</p><p className="font-bold text-violet-600">{formatCurrency(monthlyReserveAmount, 2)} ر.ع</p></div>
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
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
