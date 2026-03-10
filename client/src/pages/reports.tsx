import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis } from "recharts";
import { ArrowDownLeft, ArrowUpRight, BarChart3, Landmark, Loader2, Receipt, Sparkles, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { cn, formatCurrency, formatPercentage } from "@/lib/utils";
import { useReportsSummary } from "@/lib/hooks";

function getPeriodName(period: string) {
  switch (period) {
    case "1month":
      return "آخر شهر";
    case "3months":
      return "آخر 3 أشهر";
    case "6months":
      return "آخر 6 أشهر";
    case "1year":
      return "آخر سنة";
    default:
      return "كل الفترات";
  }
}

const trendChartConfig = {
  income: { label: "الدخل", color: "#10b981" },
  expenses: { label: "المصروفات", color: "#ef4444" },
};

const walletChartConfig = {
  income: { label: "الدخل", color: "#0ea5e9" },
  expenses: { label: "الصرف", color: "#f97316" },
};

export default function Reports() {
  const [period, setPeriod] = useState<"all" | "1month" | "3months" | "6months" | "1year">("1month");
  const { data, isLoading } = useReportsSummary(period);

  const pieData = useMemo(() => {
    return (data?.expensesByCategory ?? []).slice(0, 5).map((item, index) => ({
      ...item,
      fill: ["#f97316", "#ef4444", "#8b5cf6", "#0ea5e9", "#14b8a6"][index % 5],
    }));
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="p-4 pb-24" dir="rtl">
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  const hasData = data.summary.transactionCount > 0 || data.summary.salarySourceCount > 0;

  return (
    <div className="p-4 pb-24 space-y-4" dir="rtl">
      <div className="text-center py-4">
        <h1 className="text-2xl font-bold">التقارير المالية</h1>
        <p className="text-muted-foreground mt-1">لوحة تحليل احترافية توضّح أين يذهب دخلك وكيف يتحرك صرفك</p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {[
          { key: "1month", label: "شهر" },
          { key: "3months", label: "3 أشهر" },
          { key: "6months", label: "6 أشهر" },
          { key: "1year", label: "سنة" },
          { key: "all", label: "الكل" },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setPeriod(item.key as typeof period)}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all",
              period === item.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="text-center">
        <span className="inline-flex items-center gap-2 px-3 py-1 bg-primary/10 text-primary rounded-full text-sm font-medium">
          <BarChart3 className="h-4 w-4" />
          {getPeriodName(period)}
        </span>
      </div>

      {!hasData ? (
        <Card className="border-dashed border-border/60">
          <CardContent className="p-8 text-center space-y-3">
            <BarChart3 className="h-10 w-10 mx-auto text-muted-foreground" />
            <h2 className="text-lg font-bold">لا توجد بيانات كافية للتقارير بعد</h2>
            <p className="text-sm text-muted-foreground">أضف حركات دخل ومصروف أو أضف راتبًا شهريًا ليبدأ النظام بعرض التحليلات.</p>
            <div className="flex items-center justify-center gap-2 pt-2">
              <Link href="/income">
                <Button size="sm">إدارة الدخل</Button>
              </Link>
              <Link href="/transactions">
                <Button variant="outline" size="sm">عرض المعاملات</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 bg-emerald-500/20 rounded-xl">
                <ArrowDownLeft className="h-5 w-5 text-emerald-600" />
              </div>
              <span className="text-xs font-medium text-emerald-700">{data.summary.transactionCount} حركة</span>
            </div>
            <p className="text-xs text-emerald-700 font-medium">إجمالي الدخل</p>
            <p className="text-xl font-bold text-emerald-700">+{formatCurrency(data.summary.totalIncome, 2)}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-red-50 to-red-100 border-red-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 bg-red-500/20 rounded-xl">
                <ArrowUpRight className="h-5 w-5 text-red-600" />
              </div>
              <span className="text-xs font-medium text-red-700">{formatPercentage(data.summary.savingsRate)}</span>
            </div>
            <p className="text-xs text-red-700 font-medium">إجمالي المصروفات</p>
            <p className="text-xl font-bold text-red-700">-{formatCurrency(data.summary.totalExpenses, 2)}</p>
          </CardContent>
        </Card>

        <Card className={cn("border-2", data.summary.netFlow >= 0 ? "border-emerald-300 bg-emerald-50/70" : "border-red-300 bg-red-50/70")}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className={cn("p-2 rounded-xl", data.summary.netFlow >= 0 ? "bg-emerald-500/20" : "bg-red-500/20")}>
                <Wallet className={cn("h-5 w-5", data.summary.netFlow >= 0 ? "text-emerald-600" : "text-red-600")} />
              </div>
              <span className={cn("text-xs font-medium", data.summary.netFlow >= 0 ? "text-emerald-700" : "text-red-700")}>
                {data.summary.netFlow >= 0 ? "فائض" : "عجز"}
              </span>
            </div>
            <p className="text-xs font-medium text-muted-foreground">صافي التدفق</p>
            <p className={cn("text-xl font-bold", data.summary.netFlow >= 0 ? "text-emerald-700" : "text-red-700")}>
              {data.summary.netFlow >= 0 ? "+" : ""}{formatCurrency(data.summary.netFlow, 2)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 bg-blue-500/20 rounded-xl">
                <Landmark className="h-5 w-5 text-blue-600" />
              </div>
              <span className="text-xs font-medium text-blue-700">{data.summary.salarySourceCount} راتب</span>
            </div>
            <p className="text-xs text-blue-700 font-medium">الدخل الثابت المُعد</p>
            <p className="text-xl font-bold text-blue-700">{formatCurrency(data.summary.recurringConfiguredTotal, 2)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-primary font-semibold mb-1">نظرة تنفيذية سريعة</p>
              <h3 className="font-bold text-lg">ماذا يخبرك التقرير الآن؟</h3>
              <div className="space-y-2 mt-3 text-sm text-muted-foreground">
                {data.insights.map((insight) => (
                  <p key={insight}>{insight}</p>
                ))}
              </div>
            </div>
            <div className="h-11 w-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            اتجاه الدخل والمصروف
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.timeline.length > 0 ? (
            <ChartContainer config={trendChartConfig} className="h-[250px] w-full">
              <AreaChart data={data.timeline}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Area type="monotone" dataKey="income" stroke="var(--color-income)" fill="var(--color-income)" fillOpacity={0.18} strokeWidth={2} />
                <Area type="monotone" dataKey="expenses" stroke="var(--color-expenses)" fill="var(--color-expenses)" fillOpacity={0.12} strokeWidth={2} />
              </AreaChart>
            </ChartContainer>
          ) : (
            <p className="text-center text-sm text-muted-foreground py-8">لا توجد بيانات كافية للرسم</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            توزيع المصروفات حسب القسم
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {pieData.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-[1fr_260px] items-center">
              <div className="space-y-3">
                {data.expensesByCategory.slice(0, 5).map((item) => (
                  <div key={`${item.categoryId}-${item.categoryName}`} className="rounded-xl border border-border/60 p-3 bg-muted/20">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{item.categoryName}</span>
                      <span className="font-bold">{formatCurrency(item.total, 2)} ر.ع</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{item.count} معاملة</p>
                  </div>
                ))}
              </div>
              <div className="h-[250px]">
                <ChartContainer config={{ total: { label: "المصروفات" } }} className="h-full w-full">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent nameKey="categoryName" />} />
                    <Pie data={pieData} dataKey="total" nameKey="categoryName" innerRadius={55} outerRadius={85} paddingAngle={3}>
                      {pieData.map((entry) => (
                        <Cell key={`${entry.categoryId}-${entry.categoryName}`} fill={entry.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              </div>
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground py-8">لا توجد مصروفات مصنفة في هذه الفترة</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            أداء المحافظ
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.walletBreakdown.length > 0 ? (
            <>
              <ChartContainer config={walletChartConfig} className="h-[240px] w-full">
                <BarChart data={data.walletBreakdown.slice(0, 5)}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="income" fill="var(--color-income)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="expenses" fill="var(--color-expenses)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ChartContainer>
              <div className="space-y-3">
                {data.walletBreakdown.slice(0, 4).map((wallet) => (
                  <div key={wallet.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-xl border border-border/50">
                    <div>
                      <p className="font-medium text-sm">{wallet.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {wallet.transactionCount} حركة • +{formatCurrency(wallet.income, 2)} / -{formatCurrency(wallet.expenses, 2)}
                      </p>
                    </div>
                    <span className="font-bold">{formatCurrency(wallet.balance, 2)} ر.ع</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-center text-sm text-muted-foreground py-8">لا توجد محافظ أو حركات كافية للتحليل</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            التزامات قادمة
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.upcomingObligations.length > 0 ? data.upcomingObligations.map((obligation) => (
            <div key={obligation.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-xl border border-border/50">
              <div>
                <p className="font-medium text-sm">{obligation.title}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {obligation.frequency === "monthly"
                    ? `شهري - يوم ${obligation.dueDay ?? "-"}`
                    : obligation.frequency === "yearly"
                      ? `سنوي - ${obligation.dueDay ?? "-"}/${obligation.dueMonth ?? "-"}`
                      : "مرة واحدة"}
                </p>
              </div>
              <span className="font-bold text-destructive">{formatCurrency(obligation.amount, 2)} ر.ع</span>
            </div>
          )) : <p className="text-center text-sm text-muted-foreground py-6">لا توجد التزامات قريبة في الوقت الحالي</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <ArrowDownLeft className="h-5 w-5 text-primary" />
            آخر المعاملات في الفترة
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.recentTransactions.length > 0 ? data.recentTransactions.map((tx) => (
            <div key={tx.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-xl border border-border/50">
              <div>
                <p className="font-medium text-sm">{tx.note || tx.categoryName || "معاملة"}</p>
                <p className="text-xs text-muted-foreground mt-1">{tx.walletName || "بدون محفظة"}</p>
              </div>
              <span className={cn("font-bold", tx.type === "income" ? "text-emerald-600" : "text-red-600")}>
                {tx.type === "income" ? "+" : "-"}{formatCurrency(tx.amount, 2)}
              </span>
            </div>
          )) : <p className="text-center text-sm text-muted-foreground py-6">لا توجد معاملات حديثة في هذه الفترة</p>}
        </CardContent>
      </Card>
    </div>
  );
}
