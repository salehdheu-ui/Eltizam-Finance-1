import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { calculateSavingsGoalMonths, calculateSavingsGoalProgress, calculateSavingsGoalRemaining, calculateSavingsGoalSavedAmount, loadSavingsGoals, saveSavingsGoals, type SavingsGoalDraft } from "@/lib/savings-goals";
import { useWallets } from "@/lib/hooks";
import { ArrowRight, Goal, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

export default function SavingsGoalsPage() {
  const [goals, setGoals] = useState<SavingsGoalDraft[]>([]);
  const { data: wallets = [] } = useWallets();

  useEffect(() => {
    setGoals(loadSavingsGoals());
  }, []);

  const summary = useMemo(() => {
    const totalTarget = goals.reduce((sum, goal) => sum + goal.targetAmount, 0);
    const totalMonthly = goals.reduce((sum, goal) => sum + goal.monthlyAmount, 0);
    const totalSaved = goals.reduce((sum, goal) => sum + calculateSavingsGoalSavedAmount(goal, wallets), 0);
    const averageProgress = goals.length > 0
      ? goals.reduce((sum, goal) => sum + calculateSavingsGoalProgress(goal, wallets), 0) / goals.length
      : 0;

    return {
      totalTarget,
      totalMonthly,
      totalSaved,
      averageProgress,
    };
  }, [goals, wallets]);

  const handleDeleteGoal = (goalId: string) => {
    const nextGoals = goals.filter((goal) => goal.id !== goalId);
    setGoals(nextGoals);
    saveSavingsGoals(nextGoals);
  };

  return (
    <div className="app-page space-y-4 text-right" dir="rtl">
      <div className="space-y-1">
        <h1 className="text-xl font-bold sm:text-2xl">الأهداف الادخارية</h1>
        <p className="text-sm text-muted-foreground">كل أهدافك الادخارية المرتبطة بالخطط المعتمدة في مكان واحد</p>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-row items-center justify-start gap-2 text-right text-base sm:text-lg">
            <Sparkles className="h-5 w-5 text-primary" />
            ملخص الأهداف
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border bg-white p-3">
            <p className="text-xs text-muted-foreground">عدد الأهداف</p>
            <p className="mt-1 text-lg font-bold text-foreground">{goals.length}</p>
          </div>
          <div className="rounded-xl border bg-white p-3">
            <p className="text-xs text-muted-foreground">إجمالي المبالغ المستهدفة</p>
            <p className="mt-1 text-lg font-bold text-primary"><CurrencyDisplay amount={summary.totalTarget} fractionDigits={2} /></p>
          </div>
          <div className="rounded-xl border bg-white p-3">
            <p className="text-xs text-muted-foreground">إجمالي الادخار الشهري</p>
            <p className="mt-1 text-lg font-bold text-emerald-700"><CurrencyDisplay amount={summary.totalMonthly} fractionDigits={2} /></p>
          </div>
          <div className="rounded-xl border bg-white p-3">
            <p className="text-xs text-muted-foreground">الإجمالي المحفوظ فعلياً</p>
            <p className="mt-1 text-lg font-bold text-emerald-700"><CurrencyDisplay amount={summary.totalSaved} fractionDigits={2} /></p>
          </div>
        </CardContent>
      </Card>

      {goals.length > 0 ? (
        <div className="grid gap-4">
          {goals.map((goal) => {
            const progress = calculateSavingsGoalProgress(goal, wallets);
            const months = calculateSavingsGoalMonths(goal);
            const currentSaved = calculateSavingsGoalSavedAmount(goal, wallets);
            const remainingAmount = calculateSavingsGoalRemaining(goal, wallets);
            const linkedWallet = wallets.find((wallet) => wallet.id === goal.walletId);

            return (
              <Card key={goal.id} className="overflow-hidden">
                <CardContent className="space-y-4 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row-reverse sm:items-start sm:justify-between">
                    <div className="min-w-0 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{goal.planTitle}</span>
                        <h2 className="text-base font-bold text-foreground sm:text-lg">{goal.title}</h2>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">خطة على {goal.years} سنوات</p>
                      <p className="mt-1 text-xs text-muted-foreground">المحفظة المرتبطة: <span className="font-bold text-foreground">{linkedWallet?.name ?? goal.walletName ?? "غير محددة"}</span></p>
                    </div>
                    <Button variant="outline" className="gap-2 text-muted-foreground" onClick={() => handleDeleteGoal(goal.id)}>
                      <Trash2 className="h-4 w-4" />
                      حذف الهدف
                    </Button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border bg-slate-50 p-3">
                      <p className="text-xs text-muted-foreground">المبلغ المستهدف</p>
                      <p className="mt-1 font-bold text-foreground"><CurrencyDisplay amount={goal.targetAmount} fractionDigits={2} /></p>
                    </div>
                    <div className="rounded-xl border bg-slate-50 p-3">
                      <p className="text-xs text-muted-foreground">الرصيد الحالي في المحفظة</p>
                      <p className="mt-1 font-bold text-emerald-700"><CurrencyDisplay amount={currentSaved} fractionDigits={2} /></p>
                    </div>
                    <div className="rounded-xl border bg-slate-50 p-3">
                      <p className="text-xs text-muted-foreground">المتبقي لتحقيق الهدف</p>
                      <p className="mt-1 font-bold text-primary"><CurrencyDisplay amount={remainingAmount} fractionDigits={2} /></p>
                    </div>
                  </div>

                  <div className="rounded-xl border bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">الادخار الشهري المخطط</p>
                      <p className="font-bold text-emerald-700"><CurrencyDisplay amount={goal.monthlyAmount} fractionDigits={2} /></p>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">الوقت التقريبي حسب الخطة</p>
                      <p className="font-bold text-primary">{months ? `${months} شهر` : "غير متاح"}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-bold text-primary">{progress.toFixed(0)}%</span>
                      <span className="text-muted-foreground">نسبة التقدم الفعلية من المحفظة</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="ml-auto h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center">
            <Goal className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="font-bold text-foreground">لا توجد أهداف ادخارية بعد</p>
            <p className="mt-1 text-sm text-muted-foreground">ابدأ من صفحة خطط الادخار واعتمد خطة ثم أضف هدفك الأول.</p>
            <Link href="/financial-plans?tab=plans">
              <Button className="mt-4 gap-2">
                <ArrowRight className="h-4 w-4" />
                اذهب إلى خطط الادخار
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
