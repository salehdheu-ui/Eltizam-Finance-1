import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTransactions, useWallets } from "@/lib/hooks";
import { cn, formatCurrency, parseNumericInput } from "@/lib/utils";
import { 
  Target, Calendar, TrendingUp, PiggyBank, Wallet, 
  ArrowRight, Sparkles, ChevronDown, ChevronUp 
} from "lucide-react";

export default function FinancialPlans() {
  const { data: transactions = [] } = useTransactions();
  const { data: wallets = [] } = useWallets();
  
  const [planYears, setPlanYears] = useState<3 | 5 | 10>(5);
  const [monthlySavingsGoal, setMonthlySavingsGoal] = useState<string>("");
  const [targetAmount, setTargetAmount] = useState<string>("");

  // Calculate current financial stats
  const totalBalance = wallets.reduce((sum, w) => sum + w.balance, 0);
  
  const lastMonthIncome = transactions
    .filter(t => {
      const d = new Date(t.date);
      const now = new Date();
      const diffDays = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
      return t.type === "income" && diffDays <= 30;
    })
    .reduce((sum, t) => sum + t.amount, 0);

  const lastMonthExpenses = transactions
    .filter(t => {
      const d = new Date(t.date);
      const now = new Date();
      const diffDays = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
      return t.type === "expense" && diffDays <= 30;
    })
    .reduce((sum, t) => sum + t.amount, 0);

  const monthlySavings = lastMonthIncome - lastMonthExpenses;
  const avgMonthlyIncome = lastMonthIncome;

  // Calculate projections
  const months = planYears * 12;
  const projectedSavings = monthlySavings * months;
  const futureBalance = totalBalance + projectedSavings;
  
  const parsedTargetAmount = parseNumericInput(targetAmount);
  const parsedMonthlySavingsGoal = parseNumericInput(monthlySavingsGoal);
  const targetNum = parsedTargetAmount ?? 0;
  const monthlyGoalNum = parsedMonthlySavingsGoal ?? 0;
  
  // Calculate when target will be reached
  const monthsToTarget = targetNum > totalBalance && monthlySavings > 0 
    ? Math.ceil((targetNum - totalBalance) / monthlySavings)
    : null;

  const monthsToTargetWithGoal = targetNum > totalBalance && monthlyGoalNum > 0
    ? Math.ceil((targetNum - totalBalance) / monthlyGoalNum)
    : null;
  
  const yearsToTarget = monthsToTarget ? Math.floor(monthsToTarget / 12) : null;
  const remainingMonths = monthsToTarget ? monthsToTarget % 12 : null;
  const goalProgress = targetNum > 0 ? Math.min((totalBalance / targetNum) * 100, 100) : 0;

  // Savings scenarios
  const scenarios = [
    { rate: 0.05, label: "5% سنوياً (محافظ)" },
    { rate: 0.08, label: "8% سنوياً (معتدل)" },
    { rate: 0.12, label: "12% سنوياً (نشط)" },
  ];

  const calculateCompoundInterest = (principal: number, monthlyContribution: number, years: number, annualRate: number) => {
    const monthlyRate = annualRate / 12;
    const totalMonths = years * 12;
    let total = principal;
    
    for (let i = 0; i < totalMonths; i++) {
      total = total * (1 + monthlyRate) + monthlyContribution;
    }
    
    return total;
  };

  return (
    <div className="p-4 pb-24 space-y-4" dir="rtl">
      {/* Header */}
      <div className="text-center py-4">
        <h1 className="text-2xl font-bold">الخطط المالية</h1>
        <p className="text-muted-foreground mt-1">خطط لمستقبلك المالي</p>
      </div>

      {/* Period Selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            اختيار الفترة
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {[3, 5, 10].map((years) => (
              <button
                key={years}
                onClick={() => setPlanYears(years as 3 | 5 | 10)}
                className={cn(
                  "flex-1 py-3 rounded-xl text-sm font-bold transition-all",
                  planYears === years
                    ? "bg-primary text-primary-foreground shadow-lg"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {years} سنوات
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Current Status */}
      <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            وضعك المالي الحالي
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-white rounded-xl border">
              <p className="text-xs text-muted-foreground">الرصيد الحالي</p>
              <p className="text-lg font-bold text-primary">{formatCurrency(totalBalance, 2)} ر.ع</p>
            </div>
            <div className="p-3 bg-white rounded-xl border">
              <p className="text-xs text-muted-foreground">دخل شهري متوسط</p>
              <p className="text-lg font-bold text-emerald-600">+{formatCurrency(avgMonthlyIncome, 2)} ر.ع</p>
            </div>
          </div>
          <div className="p-3 bg-white rounded-xl border">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">ادخار شهري حالي</span>
              <span className={cn("font-bold", monthlySavings >= 0 ? "text-emerald-600" : "text-red-600")}>
                {monthlySavings >= 0 ? "+" : ""}{formatCurrency(monthlySavings, 2)} ر.ع
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Future Projection */}
      <Card className="bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-600" />
            التوقعات بعد {planYears} سنوات
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center p-4 bg-white rounded-xl border">
            <p className="text-sm text-muted-foreground mb-1">الرصيد المتوقع</p>
            <p className="text-3xl font-bold text-emerald-600">{formatCurrency(futureBalance, 2)} ر.ع</p>
            <p className="text-xs text-muted-foreground mt-2">
              بناءً على ادخارك الشهري الحالي ({formatCurrency(monthlySavings, 2)} ر.ع)
            </p>
          </div>

          {/* Investment Scenarios */}
          <div className="space-y-2">
            <p className="text-sm font-medium">سيناريوهات الاستثمار:</p>
            {scenarios.map((scenario) => {
              const futureValue = calculateCompoundInterest(totalBalance, monthlySavings, planYears, scenario.rate);
              const profit = futureValue - futureBalance;
              return (
                <div key={scenario.rate} className="p-3 bg-white rounded-xl border">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">{scenario.label}</span>
                    <span className="font-bold text-emerald-600">{formatCurrency(futureValue, 2)} ر.ع</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    أرباح إضافية: +{formatCurrency(profit, 2)} ر.ع
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Target Goal */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            حدد هدفك المالي
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">المبلغ المستهدف (ر.ع)</label>
            <Input
              type="text"
              inputMode="decimal"
              placeholder="مثال: 10000"
              value={targetAmount}
              onChange={(e) => setTargetAmount(e.target.value)}
              className="text-left"
              dir="ltr"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">الادخار الشهري المستهدف (ر.ع)</label>
            <Input
              type="text"
              inputMode="decimal"
              placeholder="مثال: 500"
              value={monthlySavingsGoal}
              onChange={(e) => setMonthlySavingsGoal(e.target.value)}
              className="text-left"
              dir="ltr"
            />
          </div>

          {targetNum > 0 && (
            <div className="p-4 bg-primary/10 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <span className="font-bold">التحليل:</span>
              </div>
              
              {monthsToTarget && monthsToTarget > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm">
                    <span className="font-medium">الوقت المتوقع لتحقيق الهدف:</span>
                  </p>
                  <p className="text-lg font-bold text-primary">
                    {yearsToTarget} سنة {remainingMonths} شهر
                  </p>
                  <p className="text-xs text-muted-foreground">
                    (بناءً على ادخارك الحالي {formatCurrency(monthlySavings, 2)} ر.ع/شهر)
                  </p>
                </div>
              ) : monthsToTargetWithGoal ? (
                <div className="space-y-2">
                  <p className="text-sm">
                    <span className="font-medium">بالادخار {formatCurrency(monthlyGoalNum, 2)} ر.ع/شهر:</span>
                  </p>
                  <p className="text-lg font-bold text-primary">
                    {monthsToTargetWithGoal} شهر
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ({Math.ceil(monthsToTargetWithGoal / 12)} سنة تقريباً)
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  أدخل مبلغ الادخار الشهري المستهدف لحساب الوقت
                </p>
              )}

              {/* Progress to goal */}
              <div className="mt-3">
                <div className="flex justify-between text-sm mb-1">
                  <span>التقدم نحو الهدف</span>
                  <span>{goalProgress.toFixed(1)}%</span>
                </div>
                <div className="h-3 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${goalProgress}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action Plan */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <PiggyBank className="h-5 w-5 text-primary" />
            خطة العمل
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {monthlySavings < 0 ? (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-sm text-red-700 font-medium">
                ⚠️ تنبيه: مصروفاتك أعلى من دخلك
              </p>
              <p className="text-xs text-red-600 mt-1">
                يجب تقليل المصروفات بـ {formatCurrency(Math.abs(monthlySavings), 2)} ر.ع/شهر على الأقل
              </p>
            </div>
          ) : monthlySavings === 0 ? (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-xl">
              <p className="text-sm text-yellow-700 font-medium">
                ⚠️ لا توجد وفورات حالياً
              </p>
              <p className="text-xs text-yellow-600 mt-1">
                حاول تقليل المصروفات غير الضرورية
              </p>
            </div>
          ) : (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
              <p className="text-sm text-emerald-700 font-medium">
                ✓ أداء جيد! أنت توفر {formatCurrency(monthlySavings, 2)} ر.ع شهرياً
              </p>
              <p className="text-xs text-emerald-600 mt-1">
                استمر على هذا المنوال
              </p>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">توصيات:</p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <ArrowRight className="h-4 w-4 text-primary mt-0.5" />
                <span>خصص 20% من دخلك للادخار الطارئ</span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="h-4 w-4 text-primary mt-0.5" />
                <span>راجع المصروفات الشهرية وقلل غير الضرورية</span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="h-4 w-4 text-primary mt-0.5" />
                <span>فكر في استثمار جزء من مدخراتك</span>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
