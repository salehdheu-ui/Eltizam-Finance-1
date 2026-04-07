import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { useTransactions, useWallets } from "@/lib/hooks";
import { useRoute, useLocation } from "wouter";
import { ArrowRight, ChevronLeft, Sparkles } from "lucide-react";
import { calculateCompoundInterest, getSavingsDistributionLabel, savingsPlans } from "@/lib/savings-plans";

export default function SavingsPlanDetails() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/financial-plans/:id");
  const planId = params?.id ?? "";

  const { data: transactions = [] } = useTransactions();
  const { data: wallets = [] } = useWallets();

  const plan = savingsPlans.find((item) => item.id === planId) ?? null;

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

  const effectiveIncome = lastMonthIncome;
  const monthlySavingsAmount = plan ? effectiveIncome * plan.savingsRate : 0;
  const projectedSavings = monthlySavingsAmount * 60;
  const projectedBalance = totalBalance + projectedSavings;
  const investmentProjection = calculateCompoundInterest(totalBalance, monthlySavingsAmount, 5, 0.08);

  if (!plan) {
    return (
      <div className="app-page" dir="rtl">
        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={() => setLocation("/financial-plans")}>عودة</Button>
        </div>
        <div className="mt-6 text-center text-sm text-muted-foreground">الخطة غير موجودة</div>
      </div>
    );
  }

  return (
    <div className="app-page" dir="rtl">
      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" className="rounded-xl" onClick={() => setLocation("/financial-plans")}>عودة</Button>
        <div className="min-w-0 text-right">
          <h1 className="truncate text-lg font-bold sm:text-xl">{plan.title}</h1>
          <p className="truncate text-sm text-muted-foreground">{plan.subtitle}</p>
        </div>
        <ChevronLeft className="h-5 w-5 text-muted-foreground" />
      </div>

      <Card className="mt-4 border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-primary" />
            ملخص سريع
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-white p-3">
            <p className="text-xs text-muted-foreground">الادخار الشهري</p>
            <p className="mt-1 text-base font-bold text-emerald-700">{formatCurrency(monthlySavingsAmount, 2)} ر.ع</p>
          </div>
          <div className="rounded-xl border bg-white p-3">
            <p className="text-xs text-muted-foreground">إجمالي الادخار (5 سنوات)</p>
            <p className="mt-1 text-base font-bold text-slate-800">{formatCurrency(projectedSavings, 2)} ر.ع</p>
          </div>
          <div className="rounded-xl border bg-white p-3">
            <p className="text-xs text-muted-foreground">الرصيد المتوقع (5 سنوات)</p>
            <p className="mt-1 text-base font-bold text-primary">{formatCurrency(projectedBalance, 2)} ر.ع</p>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">كيف تعمل؟</CardTitle>
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
            <CardTitle className="text-base">التوزيع المقترح</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border p-3 text-sm text-muted-foreground">{getSavingsDistributionLabel(plan)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">كيف يحسبها النظام؟</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>الدخل المعتمد: <span className="font-bold text-foreground">{formatCurrency(effectiveIncome, 2)} ر.ع</span></p>
            <p>مصروفات آخر 30 يوم: <span className="font-bold text-foreground">{formatCurrency(lastMonthExpenses, 2)} ر.ع</span></p>
            <p>الادخار الشهري: <span className="font-bold text-foreground">{formatCurrency(monthlySavingsAmount, 2)} ر.ع</span></p>
            <p>إجمالي الادخار 5 سنوات: <span className="font-bold text-foreground">{formatCurrency(projectedSavings, 2)} ر.ع</span></p>
            <p>الرصيد المتوقع 5 سنوات: <span className={cn("font-bold", "text-foreground")}>{formatCurrency(projectedBalance, 2)} ر.ع</span></p>
            <p>مع استثمار 8%: <span className="font-bold text-foreground">{formatCurrency(investmentProjection, 2)} ر.ع</span></p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
