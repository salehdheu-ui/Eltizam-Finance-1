import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTransactions, useCategories, useWallets } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { 
  ArrowDownLeft, ArrowUpRight, Wallet, TrendingUp, TrendingDown, 
  BarChart3, PieChart, Calendar, AlertTriangle, ChevronUp, ChevronDown 
} from "lucide-react";

// Fix date format for SQLite timestamp (unixepoch)
function formatDate(dateInput: string | Date | number) {
  let d: Date;
  
  if (typeof dateInput === "number") {
    // SQLite unixepoch (seconds since 1970)
    d = new Date(dateInput * 1000);
  } else if (typeof dateInput === "string") {
    // Try parsing as number first (SQLite format)
    const num = parseInt(dateInput);
    if (!isNaN(num) && num > 1000000000) {
      d = new Date(num * 1000);
    } else {
      d = new Date(dateInput);
    }
  } else {
    d = dateInput;
  }
  
  if (isNaN(d.getTime())) {
    return "تاريخ غير معروف";
  }
  
  return d.toLocaleDateString("ar-OM", { 
    day: "numeric", 
    month: "long", 
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function isWithinPeriod(dateInput: string | Date | number, period: string) {
  let d: Date;
  
  if (typeof dateInput === "number") {
    d = new Date(dateInput * 1000);
  } else if (typeof dateInput === "string") {
    const num = parseInt(dateInput);
    if (!isNaN(num) && num > 1000000000) {
      d = new Date(num * 1000);
    } else {
      d = new Date(dateInput);
    }
  } else {
    d = dateInput;
  }
  
  if (isNaN(d.getTime())) return false;
  
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  
  switch (period) {
    case "1month": return diffDays <= 30;
    case "3months": return diffDays <= 90;
    case "6months": return diffDays <= 180;
    case "1year": return diffDays <= 365;
    default: return true;
  }
}

function getPeriodName(period: string) {
  switch (period) {
    case "1month": return "آخر شهر";
    case "3months": return "آخر 3 أشهر";
    case "6months": return "آخر 6 أشهر";
    case "1year": return "آخر سنة";
    default: return "كل الفترات";
  }
}

export default function Reports() {
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: wallets = [] } = useWallets();
  const [period, setPeriod] = useState<"all" | "1month" | "3months" | "6months" | "1year">("1month");

  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => isWithinPeriod(t.date, period));
  }, [transactions, period]);

  const currentIncome = filteredTransactions
    .filter(t => t.type === "income")
    .reduce((sum, t) => sum + t.amount, 0);
  
  const currentExpenses = filteredTransactions
    .filter(t => t.type === "expense")
    .reduce((sum, t) => sum + t.amount, 0);
  
  const currentDebt = filteredTransactions
    .filter(t => t.type === "debt")
    .reduce((sum, t) => sum + t.amount, 0);
  
  const balance = currentIncome - currentExpenses;
  const savingsRate = currentIncome > 0 ? ((currentIncome - currentExpenses) / currentIncome) * 100 : 0;

  const getPreviousPeriodTransactions = () => {
    const now = new Date();
    let startDays: number, endDays: number;
    
    switch (period) {
      case "1month":
        startDays = 60;
        endDays = 30;
        break;
      case "3months":
        startDays = 180;
        endDays = 90;
        break;
      case "6months":
        startDays = 360;
        endDays = 180;
        break;
      case "1year":
        startDays = 730;
        endDays = 365;
        break;
      default:
        return [];
    }
    
    return transactions.filter(t => {
      let d: Date;
      if (typeof t.date === "number") {
        d = new Date(t.date * 1000);
      } else if (typeof t.date === "string") {
        const num = parseInt(t.date);
        d = !isNaN(num) && num > 1000000000 ? new Date(num * 1000) : new Date(t.date);
      } else {
        d = new Date(t.date);
      }
      
      if (isNaN(d.getTime())) return false;
      
      const diffMs = now.getTime() - d.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return diffDays >= startDays && diffDays <= endDays;
    });
  };

  const prevTransactions = getPreviousPeriodTransactions();
  const prevIncome = prevTransactions.filter(t => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
  const prevExpenses = prevTransactions.filter(t => t.type === "expense").reduce((sum, t) => sum + t.amount, 0);

  const incomeChange = prevIncome > 0 ? ((currentIncome - prevIncome) / prevIncome) * 100 : 0;
  const expenseChange = prevExpenses > 0 ? ((currentExpenses - prevExpenses) / prevExpenses) * 100 : 0;

  const expensesByCategory = categories.map(cat => {
    const catExpenses = filteredTransactions
      .filter(t => t.type === "expense" && t.categoryId === cat.id)
      .reduce((sum, t) => sum + t.amount, 0);
    return { ...cat, total: catExpenses };
  }).filter(c => c.total > 0).sort((a, b) => b.total - a.total);

  const getDailyTotals = () => {
    const days: { [key: string]: { income: number; expense: number } } = {};
    filteredTransactions.forEach(t => {
      const date = new Date(t.date).toISOString().split('T')[0];
      if (!days[date]) days[date] = { income: 0, expense: 0 };
      if (t.type === "income") days[date].income += t.amount;
      if (t.type === "expense") days[date].expense += t.amount;
    });
    return Object.entries(days).slice(-7).map(([date, totals]) => ({
      date: new Date(date).toLocaleDateString("ar-OM", { weekday: "short" }),
      ...totals
    }));
  };

  const dailyTotals = getDailyTotals();
  const biggestGap = currentIncome - currentExpenses;
  const gapStatus = biggestGap >= 0 ? "positive" : "negative";

  return (
    <div className="p-4 pb-24 space-y-4" dir="rtl">
      <div className="text-center py-4">
        <h1 className="text-2xl font-bold">التقارير المالية</h1>
        <p className="text-muted-foreground mt-1">مقارنات وتحليل تفصيلي لحركاتك</p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {[
          { key: "1month", label: "شهر" },
          { key: "3months", label: "3 أشهر" },
          { key: "6months", label: "6 أشهر" },
          { key: "1year", label: "سنة" },
          { key: "all", label: "الكل" },
        ].map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key as any)}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all",
              period === p.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="text-center">
        <span className="inline-flex items-center gap-2 px-3 py-1 bg-primary/10 text-primary rounded-full text-sm font-medium">
          <Calendar className="h-4 w-4" />
          {getPeriodName(period)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="p-2 bg-emerald-500/20 rounded-xl">
                <ArrowDownLeft className="h-5 w-5 text-emerald-600" />
              </div>
              {period !== "all" && (
                <div className={cn("flex items-center text-xs font-medium", incomeChange >= 0 ? "text-emerald-600" : "text-red-600")}>
                  {incomeChange >= 0 ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {Math.abs(incomeChange).toFixed(1)}%
                </div>
              )}
            </div>
            <div className="mt-3">
              <p className="text-xs text-emerald-600 font-medium">إجمالي الدخل</p>
              <p className="text-xl font-bold text-emerald-700">+{currentIncome.toFixed(2)}</p>
              {period !== "all" && (
                <p className="text-xs text-muted-foreground mt-1">مقارنة بالفترة السابقة</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-red-50 to-red-100 border-red-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="p-2 bg-red-500/20 rounded-xl">
                <ArrowUpRight className="h-5 w-5 text-red-600" />
              </div>
              {period !== "all" && (
                <div className={cn("flex items-center text-xs font-medium", expenseChange <= 0 ? "text-emerald-600" : "text-red-600")}>
                  {expenseChange <= 0 ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                  {Math.abs(expenseChange).toFixed(1)}%
                </div>
              )}
            </div>
            <div className="mt-3">
              <p className="text-xs text-red-600 font-medium">إجمالي المصروفات</p>
              <p className="text-xl font-bold text-red-700">-{currentExpenses.toFixed(2)}</p>
              {period !== "all" && (
                <p className="text-xs text-muted-foreground mt-1">مقارنة بالفترة السابقة</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className={cn("border-2", gapStatus === "positive" ? "bg-gradient-to-br from-blue-50 to-emerald-50 border-emerald-300" : "bg-gradient-to-br from-blue-50 to-red-50 border-red-300")}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className={cn("p-2 rounded-xl", gapStatus === "positive" ? "bg-emerald-500/20" : "bg-red-500/20")}>
                <Wallet className={cn("h-5 w-5", gapStatus === "positive" ? "text-emerald-600" : "text-red-600")} />
              </div>
              <div className={cn("px-2 py-1 rounded-full text-xs font-bold", gapStatus === "positive" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
                {gapStatus === "positive" ? "✓ فائض" : "⚠ عجز"}
              </div>
            </div>
            <div className="mt-3">
              <p className={cn("text-xs font-medium", gapStatus === "positive" ? "text-emerald-600" : "text-red-600")}>الفجوة المالية (الثغرة)</p>
              <p className={cn("text-xl font-bold", gapStatus === "positive" ? "text-emerald-700" : "text-red-700")}>
                {gapStatus === "positive" ? "+" : ""}{balance.toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {gapStatus === "positive" ? "دخلك أعلى من مصروفاتك" : "مصروفاتك أعلى من دخلك"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="p-2 bg-purple-500/20 rounded-xl">
                <TrendingUp className="h-5 w-5 text-purple-600" />
              </div>
              <div className={cn("px-2 py-1 rounded-full text-xs font-bold", savingsRate >= 20 ? "bg-emerald-100 text-emerald-700" : savingsRate >= 0 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700")}>
                {savingsRate >= 20 ? "ممتاز" : savingsRate >= 0 ? "جيد" : "ضعيف"}
              </div>
            </div>
            <div className="mt-3">
              <p className="text-xs text-purple-600 font-medium">معدل الادخار</p>
              <p className="text-xl font-bold text-purple-700">{savingsRate.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground mt-1">
                {savingsRate >= 20 ? "أداء ممتاز! واصل" : savingsRate >= 0 ? "حاول زيادة الادخار" : "تحذير: أنفق أكثر مما تدخل"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {dailyTotals.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              التدفق المالي اليومي
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {dailyTotals.map((day, idx) => {
                const max = Math.max(day.income, day.expense) || 1;
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{day.date}</span>
                      <div className="flex gap-4">
                        <span className="text-emerald-600">+{day.income.toFixed(0)}</span>
                        <span className="text-red-600">-{day.expense.toFixed(0)}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 h-8">
                      <div 
                        className="bg-emerald-400 rounded-r-md transition-all"
                        style={{ width: `${(day.income / max) * 50}%` }}
                      />
                      <div 
                        className="bg-red-400 rounded-l-md transition-all"
                        style={{ width: `${(day.expense / max) * 50}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className={cn("border-2", gapStatus === "negative" ? "border-red-300 bg-red-50/50" : "border-emerald-300 bg-emerald-50/50")}>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className={cn("h-5 w-5", gapStatus === "negative" ? "text-red-500" : "text-emerald-500")} />
            تحليل الثغرات المالية
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-white rounded-xl border">
              <p className="text-sm text-muted-foreground">إجمالي الدخل</p>
              <p className="text-lg font-bold text-emerald-600">+{currentIncome.toFixed(2)}</p>
            </div>
            <div className="p-3 bg-white rounded-xl border">
              <p className="text-sm text-muted-foreground">إجمالي المصروفات</p>
              <p className="text-lg font-bold text-red-600">-{currentExpenses.toFixed(2)}</p>
            </div>
          </div>
          
          <div className="p-4 bg-white rounded-xl border">
            <div className="flex justify-between items-center mb-2">
              <span className="font-medium">الفرق (الفجوة)</span>
              <span className={cn("text-xl font-bold", gapStatus === "positive" ? "text-emerald-600" : "text-red-600")}>
                {balance >= 0 ? "+" : ""}{balance.toFixed(2)}
              </span>
            </div>
            <div className="h-3 bg-muted rounded-full overflow-hidden">
              <div 
                className={cn("h-full transition-all", gapStatus === "positive" ? "bg-emerald-500" : "bg-red-500")}
                style={{ width: `${Math.min(Math.abs(savingsRate), 100)}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground mt-2 text-center">
              {gapStatus === "positive" 
                ? `أنت توفر ${savingsRate.toFixed(1)}% من دخلك. استمر!` 
                : `أنفقت ${Math.abs(savingsRate).toFixed(1)}% أكثر من دخلك. حاول تقليل المصروفات!`}
            </p>
          </div>

          {currentDebt > 0 && (
            <div className="p-3 bg-orange-50 border border-orange-200 rounded-xl">
              <div className="flex items-center gap-2 text-orange-700">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-medium">ديون مستحقة: {currentDebt.toFixed(2)} ر.ع</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {expensesByCategory.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <PieChart className="h-5 w-5 text-primary" />
              توزيع المصروفات حسب القسم
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {expensesByCategory.map((cat) => {
              const percentage = currentExpenses > 0 ? (cat.total / currentExpenses) * 100 : 0;
              const isHigh = percentage > 30;
              return (
                <div key={cat.id} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{cat.icon}</span>
                      <span className="font-medium">{cat.name}</span>
                      {isHigh && <span className="text-xs text-red-500 font-bold">⚠ مرتفع</span>}
                    </div>
                    <div className="text-left">
                      <span className="font-bold">{cat.total.toFixed(2)}</span>
                      <span className={cn("text-xs mr-1 font-medium", isHigh ? "text-red-500" : "text-muted-foreground")}>
                        ({percentage.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", isHigh ? "bg-red-500" : "bg-primary")}
                      style={{ width: `${Math.min(percentage, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            ملخص المحافظ
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {wallets.map((wallet) => {
            const walletTransactions = filteredTransactions.filter(t => t.walletId === wallet.id);
            const walletIncome = walletTransactions.filter(t => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
            const walletExpense = walletTransactions.filter(t => t.type === "expense").reduce((sum, t) => sum + t.amount, 0);
            return (
              <div key={wallet.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center text-white bg-gradient-to-br", wallet.color)}>
                    <Wallet className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="font-medium block">{wallet.name}</span>
                    <span className="text-xs text-muted-foreground">
                      +{walletIncome.toFixed(0)} / -{walletExpense.toFixed(0)}
                    </span>
                  </div>
                </div>
                <span className="font-bold">{wallet.balance.toFixed(2)} ر.ع</span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">آخر المعاملات في الفترة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {filteredTransactions.length > 0 ? (
            filteredTransactions.slice(0, 10).map((tx) => (
              <div key={tx.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "h-10 w-10 rounded-xl flex items-center justify-center",
                    tx.type === "income" ? "bg-emerald-100 text-emerald-600" :
                    tx.type === "expense" ? "bg-red-100 text-red-600" :
                    "bg-orange-100 text-orange-600"
                  )}>
                    {tx.type === "income" ? <TrendingUp className="h-5 w-5" /> :
                     tx.type === "expense" ? <TrendingDown className="h-5 w-5" /> :
                     <Wallet className="h-5 w-5" />}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{tx.note || tx.categoryName || "معاملة"}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(tx.date)}</p>
                  </div>
                </div>
                <span className={cn(
                  "font-bold",
                  tx.type === "income" ? "text-emerald-600" :
                  tx.type === "expense" ? "text-red-600" :
                  "text-orange-600"
                )}>
                  {tx.type === "income" ? "+" : tx.type === "expense" ? "-" : ""}{tx.amount.toFixed(2)}
                </span>
              </div>
            ))
          ) : (
            <p className="text-center text-muted-foreground py-4">لا توجد معاملات في هذه الفترة</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
