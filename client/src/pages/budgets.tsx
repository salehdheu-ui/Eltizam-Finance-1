import { ChevronLeft, Loader2, PiggyBank, Save, Target, TrendingDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCategories, useBudgets, useUpsertBudget } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";

function currentMonthKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function clampPercentage(value: number) {
  return Math.min(Math.max(value, 0), 100);
}

export default function BudgetsPage() {
  const [monthKey, setMonthKey] = useState(currentMonthKey);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const { data: categories = [], isLoading: categoriesLoading } = useCategories();
  const { data: budgets = [], isLoading: budgetsLoading } = useBudgets(monthKey);
  const upsertBudget = useUpsertBudget();
  const { toast } = useToast();

  const expenseCategories = useMemo(
    () => categories.filter((category) => category.type === "expense" || category.type === "debt"),
    [categories],
  );
  const budgetByCategory = useMemo(() => new Map(budgets.map((budget) => [budget.categoryId, budget])), [budgets]);

  const saveBudget = async (categoryId: number) => {
    const raw = drafts[categoryId] ?? String(budgetByCategory.get(categoryId)?.amount ?? "0");
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      toast({ title: "قيمة غير صالحة", description: "أدخل مبلغاً يساوي صفراً أو أكبر", variant: "destructive" });
      return;
    }
    try {
      await upsertBudget.mutateAsync({ categoryId, monthKey, amount });
      toast({ title: "تم حفظ الميزانية", description: "تم تحديث حد الفئة لهذا الشهر" });
    } catch (error) {
      toast({ title: "تعذر الحفظ", description: error instanceof Error ? error.message : "حدث خطأ غير متوقع", variant: "destructive" });
    }
  };

  const isLoading = categoriesLoading || budgetsLoading;

  return (
    <div className="space-y-6 pb-24" dir="rtl">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary">
            <Target className="h-5 w-5" />
            <span className="text-sm font-bold">التحكم الشهري</span>
          </div>
          <h1 className="text-2xl font-black sm:text-3xl">الميزانيات</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">حدد سقفاً لكل فئة وتابع الإنفاق الفعلي قبل أن يتجاوز خطتك.</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          الشهر
          <input
            type="month"
            value={monthKey}
            onChange={(event) => setMonthKey(event.target.value)}
            className="app-input rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
            aria-label="اختر الشهر"
          />
        </label>
      </header>

      <Card className="border-primary/15 bg-gradient-to-br from-primary/[0.07] via-background to-background">
        <CardContent className="grid gap-4 p-4 sm:grid-cols-3 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"><PiggyBank className="h-5 w-5" /></div>
            <div><p className="text-xs text-muted-foreground">إجمالي الميزانيات</p><p className="text-lg font-black">{formatCurrency(budgets.reduce((sum, budget) => sum + budget.amount, 0), 2)} ﷼</p></div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600"><TrendingDown className="h-5 w-5" /></div>
            <div><p className="text-xs text-muted-foreground">المنفق حتى الآن</p><p className="text-lg font-black">{formatCurrency(budgets.reduce((sum, budget) => sum + budget.spent, 0), 2)} ﷼</p></div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600"><Target className="h-5 w-5" /></div>
            <div><p className="text-xs text-muted-foreground">الفئات المعرّفة</p><p className="text-lg font-black">{budgets.length} <span className="text-sm font-medium text-muted-foreground">من {expenseCategories.length}</span></p></div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : expenseCategories.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Target className="h-10 w-10 text-muted-foreground/50" />
            <h2 className="font-bold">أضف فئة مصروف أولاً</h2>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">ستظهر فئات المصروف هنا حتى تحدد لها ميزانيات شهرية.</p>
            <Link href="/categories"><Button>إدارة الفئات <ChevronLeft className="mr-2 h-4 w-4" /></Button></Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {expenseCategories.map((category) => {
            const budget = budgetByCategory.get(category.id);
            const raw = drafts[category.id] ?? (budget ? String(budget.amount) : "");
            const progress = budget ? clampPercentage(budget.percentage) : 0;
            const overBudget = Boolean(budget && budget.spent > budget.amount);
            return (
              <Card key={category.id} className="overflow-hidden">
                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-4 pb-2">
                  <div>
                    <CardTitle className="text-base">{category.name}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">{budget ? `${formatCurrency(budget.spent, 2)} من ${formatCurrency(budget.amount, 2)} ﷼` : "لم تحدد ميزانية لهذا الشهر"}</p>
                  </div>
                  <span className="rounded-full bg-muted px-2 py-1 text-xs font-bold">{budget ? `${budget.percentage}%` : "—"}</span>
                </CardHeader>
                <CardContent className="space-y-4 p-4 pt-2">
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className={overBudget ? "h-full rounded-full bg-rose-500" : "h-full rounded-full bg-primary"} style={{ width: `${progress}%` }} />
                  </div>
                  <div className="flex items-end gap-2">
                    <label className="flex-1 text-xs font-medium text-muted-foreground">
                      الحد الشهري بالريال
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        value={raw}
                        onChange={(event) => setDrafts((current) => ({ ...current, [category.id]: event.target.value }))}
                        className="mt-1 rounded-xl"
                        placeholder="0.000"
                      />
                    </label>
                    <Button onClick={() => saveBudget(category.id)} disabled={upsertBudget.isPending} className="rounded-xl">
                      {upsertBudget.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      <span className="mr-2 hidden sm:inline">حفظ</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
