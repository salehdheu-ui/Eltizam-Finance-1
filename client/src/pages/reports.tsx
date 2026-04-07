import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis } from "recharts";
import { ArrowDownLeft, ArrowUpRight, BarChart3, Landmark, Loader2, Printer, Receipt, Sparkles, Wallet } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn, formatCurrency, formatPercentage, normalizeArabicText } from "@/lib/utils";
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

const expenseCategoryColors = [
  "#234F8D",
  "#3F93A8",
  "#4FC3A1",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#06B6D4",
  "#84CC16",
  "#F97316",
];

export default function Reports() {
  const [period, setPeriod] = useState<"all" | "1month" | "3months" | "6months" | "1year">("1month");
  const [showAllRecentTransactions, setShowAllRecentTransactions] = useState(false);
  const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState(false);
  const isMobile = useIsMobile();
  const { data, isLoading } = useReportsSummary(period);

  const pieData = useMemo(() => {
    const expenses = data?.expensesByCategory ?? [];
    const total = expenses.reduce((sum, item) => sum + item.total, 0);

    return expenses.map((item, index) => ({
      ...item,
      fill: expenseCategoryColors[index % expenseCategoryColors.length],
      percentValue: total > 0 ? Math.round((item.total / total) * 100) : 0,
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
  const visibleRecentTransactions = showAllRecentTransactions
    ? data.recentTransactions
    : data.recentTransactions.slice(0, 4);
  const printRecentTransactions = data.recentTransactions.slice(0, 8);
  const printUpcomingObligations = data.upcomingObligations.slice(0, 6);

  const handlePrint = () => {
    document.body.classList.add("print-report-active");
    window.print();
    window.setTimeout(() => {
      document.body.classList.remove("print-report-active");
    }, 150);
  };

  return (
    <div className="space-y-4 overflow-x-hidden px-2 py-4 pb-24 sm:px-3 sm:py-6 xl:px-0 xl:py-8" dir="rtl">
      <div className="flex flex-col gap-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:py-4">
        <div className="text-center sm:text-right">
          <h1 className="text-xl font-bold sm:text-2xl">التقارير المالية</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">لوحة تحليل احترافية توضّح أين يذهب دخلك وكيف يتحرك صرفك</p>
        </div>
        <Button type="button" className="hide-on-print h-11 w-full rounded-2xl sm:w-auto sm:self-start" onClick={() => setIsPrintPreviewOpen(true)}>
          <Printer className="h-4 w-4" />
          طباعة / PDF
        </Button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 sm:justify-center xl:justify-start">
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
              "min-h-10 rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-all",
              period === item.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="text-center">
        <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
          <BarChart3 className="h-4 w-4" />
          {getPeriodName(period)}
        </span>
      </div>

      {!hasData ? (
        <Card className="border-dashed border-border/60">
          <CardContent className="space-y-3 p-8 text-center">
            <BarChart3 className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="text-lg font-bold">لا توجد بيانات كافية للتقارير بعد</h2>
            <p className="text-sm text-muted-foreground">أضف حركات دخل ومصروف أو أضف راتبًا شهريًا ليبدأ النظام بعرض التحليلات.</p>
            <div className="flex items-center justify-center gap-2 pt-2">
              <Link href="/income">
                <Button size="sm">إدارة الدخل</Button>
              </Link>
              <Link href="/transactions">
                <Button variant="outline" size="sm" className="whitespace-normal text-center">عرض المعاملات</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:gap-4">
        <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100">
          <CardContent className="flex min-h-[132px] flex-col justify-between p-3 sm:min-h-[156px] sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="rounded-xl bg-emerald-500/20 p-2 sm:p-2.5">
                <ArrowDownLeft className="h-4 w-4 text-emerald-600 sm:h-5 sm:w-5" />
              </div>
              <span className="text-[11px] font-medium text-emerald-700 sm:text-xs">{data.summary.transactionCount} حركة</span>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-[11px] font-medium text-emerald-700 sm:text-xs">إجمالي الدخل</p>
              <p className="break-words text-sm font-bold leading-6 text-emerald-700 sm:text-xl">+{formatCurrency(data.summary.totalIncome, 2)}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-red-200 bg-gradient-to-br from-red-50 to-red-100">
          <CardContent className="flex min-h-[132px] flex-col justify-between p-3 sm:min-h-[156px] sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="rounded-xl bg-red-500/20 p-2 sm:p-2.5">
                <ArrowUpRight className="h-4 w-4 text-red-600 sm:h-5 sm:w-5" />
              </div>
              <span className="text-[11px] font-medium text-red-700 sm:text-xs">{formatPercentage(data.summary.savingsRate)}</span>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-[11px] font-medium text-red-700 sm:text-xs">إجمالي المصروفات</p>
              <p className="break-words text-sm font-bold leading-6 text-red-700 sm:text-xl">-{formatCurrency(data.summary.totalExpenses, 2)}</p>
            </div>
          </CardContent>
        </Card>

        <Card className={cn("border-2", data.summary.netFlow >= 0 ? "border-emerald-300 bg-emerald-50/70" : "border-red-300 bg-red-50/70")}>
          <CardContent className="flex min-h-[132px] flex-col justify-between p-3 sm:min-h-[156px] sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <div className={cn("rounded-xl p-2 sm:p-2.5", data.summary.netFlow >= 0 ? "bg-emerald-500/20" : "bg-red-500/20")}>
                <Wallet className={cn("h-4 w-4 sm:h-5 sm:w-5", data.summary.netFlow >= 0 ? "text-emerald-600" : "text-red-600")} />
              </div>
              <span className={cn("text-[11px] font-medium sm:text-xs", data.summary.netFlow >= 0 ? "text-emerald-700" : "text-red-700")}>
                {data.summary.netFlow >= 0 ? "فائض" : "عجز"}
              </span>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-[11px] font-medium text-muted-foreground sm:text-xs">صافي التدفق</p>
              <p className={cn("break-words text-sm font-bold leading-6 sm:text-xl", data.summary.netFlow >= 0 ? "text-emerald-700" : "text-red-700")}>
                {data.summary.netFlow >= 0 ? "+" : ""}{formatCurrency(data.summary.netFlow, 2)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100">
          <CardContent className="flex min-h-[132px] flex-col justify-between p-3 sm:min-h-[156px] sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="rounded-xl bg-blue-500/20 p-2 sm:p-2.5">
                <Landmark className="h-4 w-4 text-blue-600 sm:h-5 sm:w-5" />
              </div>
              <span className="text-[11px] font-medium text-blue-700 sm:text-xs">{data.summary.salarySourceCount} راتب</span>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-[11px] font-medium text-blue-700 sm:text-xs">الدخل الثابت المُعد</p>
              <p className="break-words text-sm font-bold leading-6 text-blue-700 sm:text-xl">{formatCurrency(data.summary.recurringConfiguredTotal, 2)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="mb-1 text-sm font-semibold text-primary">نظرة تنفيذية سريعة</p>
              <h3 className="text-lg font-bold">ماذا يخبرك التقرير الآن؟</h3>
              <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                {data.insights.map((insight) => (
                  <p key={insight}>{insight}</p>
                ))}
              </div>
            </div>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center self-end rounded-2xl bg-primary/10 text-primary sm:self-auto">
              <Sparkles className="h-5 w-5" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.95fr)]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <BarChart3 className="h-5 w-5 text-primary" />
              اتجاه الدخل والمصروف
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-4 sm:px-6">
            {data.timeline.length > 0 ? (
              <ChartContainer config={trendChartConfig} className="h-[220px] w-full sm:h-[250px]">
                <AreaChart data={data.timeline}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={isMobile ? 24 : 12} tick={{ fontSize: isMobile ? 11 : 12 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent className="flex-wrap gap-x-3 gap-y-2 text-xs sm:text-sm" />} />
                  <Area type="monotone" dataKey="income" stroke="var(--color-income)" fill="var(--color-income)" fillOpacity={0.18} strokeWidth={2} />
                  <Area type="monotone" dataKey="expenses" stroke="var(--color-expenses)" fill="var(--color-expenses)" fillOpacity={0.12} strokeWidth={2} />
                </AreaChart>
              </ChartContainer>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">لا توجد بيانات كافية للرسم</p>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden rounded-[24px] border border-border/50 bg-card shadow-sm sm:rounded-[28px]">
          <CardHeader className="px-4 pb-0 pt-5 sm:px-6 sm:pt-6">
            <CardTitle className="text-center text-lg font-bold leading-tight text-foreground sm:justify-center sm:text-[28px]">
              توزيع النفقات حسب الأقسام
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 px-3 pb-4 pt-4 sm:space-y-6 sm:px-6 sm:pb-6">
            {pieData.length > 0 ? (
              <div className="flex flex-col items-center justify-center">
                <div className="h-[240px] w-full max-w-[260px] sm:h-[290px] sm:max-w-[320px]">
                  <ChartContainer config={{ total: { label: "النفقات" } }} className="h-full w-full">
                    <PieChart margin={{ top: isMobile ? 8 : 20, right: isMobile ? 8 : 16, left: isMobile ? 8 : 16, bottom: isMobile ? 8 : 20 }}>
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            nameKey="categoryName"
                            formatter={(value, name, item) => (
                              <div className="flex min-w-[9rem] items-center justify-between gap-3 text-xs sm:min-w-[10rem] sm:text-sm">
                                <span className="text-muted-foreground">{name}</span>
                                <span className="font-medium">
                                  {formatCurrency(Number(value), 2)} ({item.payload.percentValue}%)
                                </span>
                              </div>
                            )}
                          />
                        }
                      />
                      <Pie
                        data={pieData}
                        dataKey="total"
                        nameKey="categoryName"
                        innerRadius={isMobile ? 42 : 48}
                        outerRadius={isMobile ? 72 : 82}
                        paddingAngle={2}
                        cornerRadius={4}
                        stroke="#ffffff"
                        strokeWidth={2}
                        labelLine={false}
                        label={isMobile ? false : ({ cx, cy, midAngle, outerRadius, percent }) => {
                          const radius = Number(outerRadius) + 24;
                          const x = Number(cx) + radius * Math.cos((-midAngle * Math.PI) / 180);
                          const y = Number(cy) + radius * Math.sin((-midAngle * Math.PI) / 180);

                          return (
                            <text
                              x={x}
                              y={y}
                              fill="currentColor"
                              textAnchor={x > Number(cx) ? "start" : "end"}
                              dominantBaseline="central"
                              className="fill-foreground text-sm font-bold sm:text-base"
                            >
                              {`${Math.round((percent ?? 0) * 100)}%`}
                            </text>
                          );
                        }}
                      >
                        {pieData.map((entry) => (
                          <Cell key={`${entry.categoryId}-${entry.categoryName}`} fill={entry.fill} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                </div>
                <div className="flex w-full flex-wrap items-center justify-center gap-x-2 gap-y-2 text-xs font-semibold text-foreground sm:gap-x-6 sm:gap-y-3 sm:text-[15px]">
                  {pieData.map((item) => (
                    <div key={`${item.categoryId}-${item.categoryName}-legend`} className="max-w-full rounded-full bg-muted/40 px-2.5 py-1 sm:px-3 sm:py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="max-w-[9rem] truncate sm:max-w-none">{item.categoryName}</span>
                        <span className="h-3.5 w-3.5 shrink-0 rounded-md" style={{ backgroundColor: item.fill }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid w-full max-w-[420px] gap-2 pt-1">
                  {pieData.map((item) => (
                    <div key={`${item.categoryId}-${item.categoryName}-details`} className="flex items-center justify-between gap-3 rounded-2xl border border-border/40 bg-muted/30 px-3 py-3 text-sm sm:px-4">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.fill }} />
                        <span className="truncate font-medium text-foreground">{item.categoryName}</span>
                      </div>
                      <span className="shrink-0 font-bold text-foreground">{item.percentValue}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">لا توجد مصروفات مصنفة في هذه الفترة</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Wallet className="h-5 w-5 text-primary" />
              أداء المحافظ
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-3 pb-4 sm:px-6">
            {data.walletBreakdown.length > 0 ? (
              <>
                <ChartContainer config={walletChartConfig} className="h-[220px] w-full sm:h-[240px]">
                  <BarChart data={data.walletBreakdown.slice(0, 5)}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} height={isMobile ? 52 : 36} tick={{ fontSize: isMobile ? 10 : 12 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent className="flex-wrap gap-x-3 gap-y-2 text-xs sm:text-sm" />} />
                    <Bar dataKey="income" fill="var(--color-income)" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="expenses" fill="var(--color-expenses)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ChartContainer>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  {data.walletBreakdown.slice(0, 4).map((wallet) => (
                    <div key={wallet.id} className="flex flex-col gap-2 rounded-xl border border-border/50 bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{wallet.name}</p>
                        <p className="mt-1 break-words text-xs text-muted-foreground">
                          {wallet.transactionCount} حركة • +{formatCurrency(wallet.income, 2)} / -{formatCurrency(wallet.expenses, 2)}
                        </p>
                      </div>
                      <span className="break-words text-sm font-bold sm:shrink-0 sm:text-base">{formatCurrency(wallet.balance, 2)} ر.ع</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">لا توجد محافظ أو حركات كافية للتحليل</p>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Receipt className="h-5 w-5 text-primary" />
              التزامات قادمة
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-3 pb-4 sm:px-6">
            {data.upcomingObligations.length > 0 ? data.upcomingObligations.map((obligation) => (
              <div key={obligation.id} className="flex flex-col gap-3 rounded-xl border border-border/50 bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{obligation.title}</p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {obligation.frequency === "monthly"
                      ? `شهري - يوم ${obligation.dueDay ?? "-"}` : obligation.frequency === "yearly"
                        ? `سنوي - ${obligation.dueDay ?? "-"}/${obligation.dueMonth ?? "-"}` : "مرة واحدة"}
                  </p>
                </div>
                <span className="break-words text-sm font-bold text-destructive sm:text-base">{formatCurrency(obligation.amount, 2)} ر.ع</span>
              </div>
            )) : <p className="py-6 text-center text-sm text-muted-foreground">لا توجد التزامات قريبة في الوقت الحالي</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <ArrowDownLeft className="h-5 w-5 text-primary" />
              آخر المعاملات في الفترة
            </CardTitle>
            {data.recentTransactions.length > 4 ? (
              <Button
                type="button"
                variant="link"
                className="h-auto justify-start p-0 text-primary sm:justify-end"
                onClick={() => setShowAllRecentTransactions((current) => !current)}
              >
                {showAllRecentTransactions ? "عرض أقل" : "عرض المزيد"}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.recentTransactions.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {visibleRecentTransactions.map((tx) => (
                <div key={tx.id} className="flex flex-col gap-2 rounded-xl border border-border/50 bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <p className="line-clamp-1 text-sm font-medium">{normalizeArabicText(tx.note) || tx.categoryName || "معاملة"}</p>
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{tx.walletName || "بدون محفظة"}</p>
                  </div>
                  <span className={cn("shrink-0 text-sm font-bold sm:text-base", tx.type === "income" ? "text-emerald-600" : "text-red-600")}>
                    {tx.type === "income" ? "+" : "-"}{formatCurrency(tx.amount, 2)}
                  </span>
                </div>
              ))}
            </div>
          ) : <p className="py-6 text-center text-sm text-muted-foreground">لا توجد معاملات حديثة في هذه الفترة</p>}
        </CardContent>
      </Card>

      <Dialog open={isPrintPreviewOpen} onOpenChange={setIsPrintPreviewOpen}>
        <DialogContent dir="rtl" className="max-w-[calc(100vw-1rem)] overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="hide-on-print px-4 pt-5 text-right sm:px-6 sm:pt-6">
            <DialogTitle>معاينة تقرير التقارير المالية</DialogTitle>
            <DialogDescription>
              راجع محتوى التقرير ثم اختر الطباعة أو الحفظ كملف PDF من نافذة النظام.
            </DialogDescription>
          </DialogHeader>

          <div className="hide-on-print flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="text-sm text-muted-foreground">
              الفترة المحددة: <span className="font-medium text-foreground">{getPeriodName(period)}</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setIsPrintPreviewOpen(false)}>
                إغلاق
              </Button>
              <Button type="button" className="w-full sm:w-auto" onClick={handlePrint}>
                <Printer className="h-4 w-4" />
                طباعة / PDF
              </Button>
            </div>
          </div>

          <div className="overflow-y-auto bg-muted/20 p-3 sm:p-6" style={{ maxHeight: "calc(var(--app-viewport-height, 100vh) * 0.75)" }}>
            <div className="print-report-root mx-auto max-w-3xl space-y-4 rounded-[28px] bg-background p-4 sm:space-y-6 sm:rounded-3xl sm:p-8">
              <div className="print-break-avoid rounded-[28px] border bg-card p-4 sm:rounded-3xl sm:p-6">
                <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="space-y-2 text-right">
                    <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
                      <Printer className="h-3.5 w-3.5" />
                      تقرير مالي جاهز للطباعة
                    </div>
                    <h2 className="text-xl font-bold sm:text-2xl">التقارير المالية</h2>
                    <p className="text-sm text-muted-foreground">ملخص احترافي يوضح الأداء المالي خلال الفترة المحددة بصيغة مناسبة للطباعة والحفظ PDF</p>
                  </div>
                  <div className="text-right text-sm text-muted-foreground sm:text-left">
                    <p>الفترة: {getPeriodName(period)}</p>
                    <p>تاريخ الإنشاء: {new Date().toLocaleString("ar-OM")}</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full border px-3 py-1">عدد الحركات: {data.summary.transactionCount}</span>
                  <span className="rounded-full border px-3 py-1">الرواتب المهيأة: {data.summary.salarySourceCount}</span>
                  <span className="rounded-full border px-3 py-1">الأقساط القادمة: {data.upcomingObligations.length}</span>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border bg-emerald-50/40 p-4">
                    <p className="text-xs text-muted-foreground">إجمالي الدخل</p>
                    <p className="mt-2 break-words text-lg font-bold text-emerald-600 sm:text-xl">+{formatCurrency(data.summary.totalIncome, 2)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">كل الإيرادات المسجلة ضمن الفترة المحددة</p>
                  </div>
                  <div className="rounded-2xl border bg-red-50/40 p-4">
                    <p className="text-xs text-muted-foreground">إجمالي المصروفات</p>
                    <p className="mt-2 break-words text-lg font-bold text-red-600 sm:text-xl">-{formatCurrency(data.summary.totalExpenses, 2)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">المبالغ الخارجة من المحافظ والتصنيفات</p>
                  </div>
                  <div className="rounded-2xl border bg-primary/5 p-4">
                    <p className="text-xs text-muted-foreground">صافي التدفق</p>
                    <p className={cn("mt-2 break-words text-lg font-bold sm:text-xl", data.summary.netFlow >= 0 ? "text-emerald-600" : "text-red-600")}>
                      {data.summary.netFlow >= 0 ? "+" : ""}{formatCurrency(data.summary.netFlow, 2)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">الفرق بين الدخل والمصروفات في الفترة</p>
                  </div>
                  <div className="rounded-2xl border bg-muted/20 p-4">
                    <p className="text-xs text-muted-foreground">نسبة الادخار</p>
                    <p className="mt-2 text-lg font-bold sm:text-xl">{formatPercentage(data.summary.savingsRate)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">نسبة الفائض مقارنةً بإجمالي الدخل</p>
                  </div>
                </div>
              </div>

              <div className="print-break-avoid rounded-[28px] border bg-card p-4 sm:rounded-3xl sm:p-6">
                <h3 className="text-lg font-bold">الملخص التنفيذي</h3>
                <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                  {data.insights.length > 0 ? data.insights.map((insight) => (
                    <p key={insight}>{insight}</p>
                  )) : <p>لا توجد ملاحظات إضافية لهذه الفترة.</p>}
                </div>
              </div>

              <div className="print-break-avoid rounded-[28px] border bg-card p-4 sm:rounded-3xl sm:p-6">
                <h3 className="text-lg font-bold">أداء المحافظ</h3>
                <div className="mt-4 space-y-3">
                  {data.walletBreakdown.length > 0 ? data.walletBreakdown.slice(0, 5).map((wallet) => (
                    <div key={wallet.id} className="flex flex-col gap-2 rounded-2xl border p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold">{wallet.name}</p>
                        <p className="mt-1 break-words text-muted-foreground">{wallet.transactionCount} حركة • +{formatCurrency(wallet.income, 2)} / -{formatCurrency(wallet.expenses, 2)}</p>
                      </div>
                      <span className="shrink-0 font-bold">{formatCurrency(wallet.balance, 2)} ر.ع</span>
                    </div>
                  )) : <p className="text-sm text-muted-foreground">لا توجد بيانات كافية عن المحافظ في هذه الفترة.</p>}
                </div>
              </div>

              <div className="print-break-avoid rounded-[28px] border bg-card p-4 sm:rounded-3xl sm:p-6">
                <h3 className="text-lg font-bold">توزيع المصروفات حسب الأقسام</h3>
                <div className="mt-4 space-y-3">
                  {pieData.length > 0 ? pieData.map((item) => (
                    <div key={`${item.categoryId}-${item.categoryName}-print`} className="flex items-center justify-between gap-3 rounded-2xl border p-4 text-sm">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.fill }} />
                        <span className="truncate font-medium">{item.categoryName}</span>
                      </div>
                      <div className="shrink-0 text-left">
                        <p className="font-semibold">{formatCurrency(item.total, 2)}</p>
                        <p className="text-muted-foreground">{item.percentValue}%</p>
                      </div>
                    </div>
                  )) : <p className="text-sm text-muted-foreground">لا توجد مصروفات مصنفة في هذه الفترة.</p>}
                </div>
              </div>

              <div className="print-break-avoid rounded-[28px] border bg-card p-4 sm:rounded-3xl sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-bold">التزامات قادمة</h3>
                  <span className="text-xs text-muted-foreground">حتى 6 عناصر</span>
                </div>
                <div className="mt-4 space-y-3">
                  {printUpcomingObligations.length > 0 ? printUpcomingObligations.map((obligation) => (
                    <div key={`${obligation.id}-print-obligation`} className="flex items-center justify-between gap-3 rounded-2xl border p-4 text-sm">
                      <div className="min-w-0">
                        <p className="font-semibold">{obligation.title}</p>
                        <p className="mt-1 text-muted-foreground">
                          {obligation.frequency === "monthly"
                            ? `شهري - يوم ${obligation.dueDay ?? "-"}`
                            : obligation.frequency === "yearly"
                              ? `سنوي - ${obligation.dueDay ?? "-"}/${obligation.dueMonth ?? "-"}`
                              : "مرة واحدة"}
                        </p>
                      </div>
                      <span className="shrink-0 font-bold text-destructive">{formatCurrency(obligation.amount, 2)} ر.ع</span>
                    </div>
                  )) : <p className="text-sm text-muted-foreground">لا توجد التزامات قريبة خلال الفترة الحالية.</p>}
                </div>
              </div>

              <div className="print-break-avoid rounded-[28px] border bg-card p-4 sm:rounded-3xl sm:p-6">
                <h3 className="text-lg font-bold">آخر المعاملات</h3>
                <div className="mt-4 overflow-hidden rounded-3xl border">
                  <div className="grid grid-cols-[1.2fr_.85fr_.8fr_.8fr] border-b bg-muted/40 text-sm font-medium">
                    <div className="border-l px-4 py-3">البيان</div>
                    <div className="border-l px-4 py-3">المحفظة</div>
                    <div className="border-l px-4 py-3">النوع</div>
                    <div className="px-4 py-3">المبلغ</div>
                  </div>
                  {printRecentTransactions.length > 0 ? printRecentTransactions.map((tx) => (
                    <div key={`${tx.id}-print`} className="grid grid-cols-[1.2fr_.85fr_.8fr_.8fr] border-b last:border-b-0 text-sm">
                      <div className="border-l bg-background px-4 py-3 font-medium">{normalizeArabicText(tx.note) || tx.categoryName || "معاملة"}</div>
                      <div className="border-l px-4 py-3 text-muted-foreground">{tx.walletName || "بدون محفظة"}</div>
                      <div className="border-l px-4 py-3 text-muted-foreground">{tx.type === "income" ? "دخل" : "مصروف"}</div>
                      <div className={cn("px-4 py-3 font-bold", tx.type === "income" ? "text-emerald-600" : "text-red-600")}>
                        {tx.type === "income" ? "+" : "-"}{formatCurrency(tx.amount, 2)}
                      </div>
                    </div>
                  )) : <div className="px-4 py-6 text-center text-sm text-muted-foreground">لا توجد معاملات حديثة في هذه الفترة.</div>}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
