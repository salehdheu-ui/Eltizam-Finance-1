import { Filter, Search, Calendar, Loader2, Trash2, Wallet, PieChart, ArrowLeftRight, Printer, Receipt } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn, formatCurrency, formatRelativeArabicDate, formatTime, normalizeArabicText, toDate } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMemo, useState } from "react";
import { useTransactions, useDeleteTransaction, useWallets, useCategories } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import type { Transaction } from "@shared/schema";

function isTransferTransaction(note?: string | null) {
  return typeof note === "string" && note.startsWith("__transfer__:");
}

function getTransferLabel(note?: string | null) {
  if (!isTransferTransaction(note)) {
    return normalizeArabicText(note);
  }

  const [, , direction, , ...rest] = note!.split(":");
  const label = rest.join(":");
  return direction === "out" ? `تحويل صادر - ${normalizeArabicText(label)}` : `تحويل وارد - ${normalizeArabicText(label)}`;
}

function isWithinRange(dateInput: string | Date | number, range: "all" | "7days" | "30days" | "90days") {
  if (range === "all") return true;

  const date = toDate(dateInput);
  const diffDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);

  if (range === "7days") return diffDays <= 7;
  if (range === "30days") return diffDays <= 30;
  return diffDays <= 90;
}

const defaultIcons: Record<string, string> = {
  "طعام": "🍔", "وقود": "⛽", "إيجار": "🏠", "راتب": "💰",
  "صحة": "💊", "تسوق": "🛍️", "فواتير": "📄",
};

const defaultBgs: Record<string, string> = {
  "طعام": "bg-orange-100 dark:bg-orange-950",
  "وقود": "bg-blue-100 dark:bg-blue-950",
  "إيجار": "bg-indigo-100 dark:bg-indigo-950",
  "راتب": "bg-emerald-100 dark:bg-emerald-950",
  "صحة": "bg-red-100 dark:bg-red-950",
  "تسوق": "bg-pink-100 dark:bg-pink-950",
};

function getTransactionTypeLabel(type: Transaction["type"], note?: string | null) {
  if (type === "transfer" || isTransferTransaction(note)) return "تحويل";
  if (type === "income") return "دخل";
  if (type === "expense") return "صرف";
  return "دين";
}

export default function Transactions() {
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [walletFilter, setWalletFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [rangeFilter, setRangeFilter] = useState<"all" | "7days" | "30days" | "90days">("all");
  const [selectedTransaction, setSelectedTransaction] = useState<(Transaction & { categoryName?: string | null; categoryIcon?: string | null; walletName?: string | null }) | null>(null);
  const { data: transactions = [], isLoading } = useTransactions();
  const { data: wallets = [] } = useWallets();
  const { data: categories = [] } = useCategories();
  const deleteTransaction = useDeleteTransaction();
  const { toast } = useToast();

  const filteredTransactions = useMemo(() => {
    return transactions
      .filter((tx) => {
        if (activeTab !== "all" && tx.type !== activeTab) return false;
        if (walletFilter !== "all" && tx.walletId?.toString() !== walletFilter) return false;
        if (categoryFilter !== "all" && tx.categoryId?.toString() !== categoryFilter) return false;
        if (!isWithinRange(tx.date, rangeFilter)) return false;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          return (
            (tx.categoryName || "").toLowerCase().includes(q) ||
            (tx.walletName || "").toLowerCase().includes(q) ||
            normalizeArabicText(tx.note).toLowerCase().includes(q) ||
            tx.amount.toString().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => toDate(b.date).getTime() - toDate(a.date).getTime());
  }, [transactions, activeTab, walletFilter, categoryFilter, rangeFilter, searchQuery]);

  const totalIncome = filteredTransactions
    .filter((tx) => tx.type === "income" && !isTransferTransaction(tx.note))
    .reduce((sum, tx) => sum + tx.amount, 0);
  const totalOutflow = filteredTransactions
    .filter((tx) => (tx.type === "expense" || tx.type === "debt") && !isTransferTransaction(tx.note))
    .reduce((sum, tx) => sum + tx.amount, 0);

  const handlePrintInvoice = () => {
    document.body.classList.add("print-report-active");
    window.print();
    window.setTimeout(() => {
      document.body.classList.remove("print-report-active");
    }, 150);
  };

  const handleDelete = async (id: number) => {
    if (deleteTransaction.isPending) {
      return;
    }

    if (!window.confirm("هل تريد حذف هذه المعاملة؟")) {
      return;
    }

    try {
      await deleteTransaction.mutateAsync(id);
      toast({ title: "تم الحذف", description: "تم حذف المعاملة بنجاح" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "فشل حذف المعاملة";
      toast({ title: "خطأ", description: message, variant: "destructive" });
    }
  };

  return (
    <div className="bg-background animate-in fade-in duration-300" dir="rtl">
      <header className="sticky top-0 z-10 border-b border-border/50 bg-background/95 px-3 py-4 pb-4 backdrop-blur sm:px-4 sm:py-6 xl:px-8">
        <div className="mb-4 space-y-1">
          <h1 className="text-xl font-bold sm:text-2xl">المعاملات</h1>
          <p className="text-sm text-muted-foreground sm:text-base">ابحث بسرعة وفلتر المعاملات وسجّل كل حركة بشكل واضح ومريح على كل الأجهزة.</p>
        </div>
        
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="ابحث عن معاملة..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-4 pr-10 bg-muted/50 border-transparent focus-visible:ring-primary focus-visible:bg-background rounded-xl"
              data-testid="input-search"
            />
          </div>
        </div>
  
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4" dir="rtl">
          <TabsList className="grid h-auto w-full grid-cols-4 rounded-2xl bg-muted/50 p-1.5">
            <TabsTrigger value="all" className="rounded-xl px-1 py-2 text-[11px] sm:text-xs" data-testid="tab-all">الكل</TabsTrigger>
            <TabsTrigger value="income" className="rounded-xl px-1 py-2 text-[11px] sm:text-xs" data-testid="tab-income">دخل</TabsTrigger>
            <TabsTrigger value="expense" className="rounded-xl px-1 py-2 text-[11px] sm:text-xs" data-testid="tab-expense">صرف</TabsTrigger>
            <TabsTrigger value="debt" className="rounded-xl px-1 py-2 text-[11px] sm:text-xs" data-testid="tab-debt">ديون</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 xl:grid-cols-3">
          <select value={walletFilter} onChange={(e) => setWalletFilter(e.target.value)} className="app-select min-w-[150px] shrink-0 rounded-xl">
            <option value="all">كل المحافظ</option>
            {wallets.map((wallet) => (
              <option key={wallet.id} value={wallet.id.toString()}>{wallet.name}</option>
            ))}
          </select>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="app-select min-w-[150px] shrink-0 rounded-xl">
            <option value="all">كل الأقسام</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id.toString()}>{category.name}</option>
            ))}
          </select>
          <select value={rangeFilter} onChange={(e) => setRangeFilter(e.target.value as typeof rangeFilter)} className="app-select min-w-[150px] shrink-0 rounded-xl">
            <option value="all">كل الفترات</option>
            <option value="7days">آخر 7 أيام</option>
            <option value="30days">آخر 30 يومًا</option>
            <option value="90days">آخر 90 يومًا</option>
          </select>
        </div>
      </header>

      <div className="px-1 py-4 pb-24 sm:px-2 sm:py-6 xl:px-0 xl:py-8">
        <div className="mb-6 grid grid-cols-2 gap-3 xl:max-w-3xl">
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20 sm:p-4">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-400 sm:text-sm">
              <ArrowLeftRight className="h-4 w-4" />
              إجمالي الدخل
            </div>
            <p className="break-words text-sm font-bold text-emerald-700 dark:text-emerald-300 sm:text-xl">+{formatCurrency(totalIncome, 2)}</p>
          </div>
          <div className="rounded-2xl border border-red-100 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-950/20 sm:p-4">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-red-700 dark:text-red-400 sm:text-sm">
              <Filter className="h-4 w-4" />
              إجمالي الخروج
            </div>
            <p className="break-words text-sm font-bold text-red-700 dark:text-red-300 sm:text-xl">-{formatCurrency(totalOutflow, 2)}</p>
          </div>
        </div>

        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>أحدث المعاملات</span>
            </div>
            {(searchQuery || walletFilter !== "all" || categoryFilter !== "all" || rangeFilter !== "all") && (
              <span className="text-xs text-muted-foreground">
                {filteredTransactions.length} نتيجة
              </span>
            )}
          </div>
          
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {filteredTransactions.length > 0 ? (
                filteredTransactions.map((tx) => {
                  const isTransfer = isTransferTransaction(tx.note);
                  const catName = isTransfer ? "تحويل" : tx.categoryName || "أخرى";
                  const icon = tx.categoryIcon || defaultIcons[catName] || "📝";
                  const bg = defaultBgs[catName] || "bg-muted";
                  return (
                    <div key={tx.id} className="bg-card flex flex-col gap-3 rounded-2xl border border-border/50 p-3 shadow-sm transition-all active-elevate sm:flex-row sm:items-center sm:justify-between sm:p-3.5" data-testid={`card-transaction-${tx.id}`}>
                      <div className="flex min-w-0 items-start gap-3 sm:items-center">
                        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-lg sm:h-12 sm:w-12 sm:text-xl", bg)}>
                          {icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-start justify-between gap-3 sm:hidden">
                            <div className="min-w-0">
                              <h4 className="text-sm font-bold leading-5">{catName}</h4>
                              <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{getTransferLabel(tx.note)}</p>
                            </div>
                            <span className={cn(
                              "shrink-0 text-sm font-bold",
                              tx.type === 'income' ? "text-emerald-500" : 
                              tx.type === 'expense' ? "text-red-500" :
                              "text-gray-900 dark:text-gray-100"
                            )}>
                              {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount, 2)}
                            </span>
                          </div>
                          <div className="hidden sm:block">
                            <h4 className="text-sm font-bold">{catName}</h4>
                            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{getTransferLabel(tx.note)}</p>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                            {tx.walletName ? <span className="inline-flex items-center gap-1"><Wallet className="h-3 w-3" />{tx.walletName}</span> : null}
                            {tx.categoryName ? <span className="inline-flex items-center gap-1"><PieChart className="h-3 w-3" />{tx.categoryName}</span> : null}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/40 pt-2 sm:border-0 sm:pt-0 sm:justify-normal">
                        <div className="flex min-w-0 flex-col items-start sm:items-end">
                          <span className={cn(
                            "hidden text-sm font-bold sm:inline sm:text-base",
                            tx.type === 'income' ? "text-emerald-500" : 
                            tx.type === 'expense' ? "text-red-500" :
                            "text-gray-900 dark:text-gray-100"
                          )}>
                            {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount, 2)}
                          </span>
                          <span className="text-[10px] text-muted-foreground sm:mt-1 sm:text-right">
                            {tx.date && formatRelativeArabicDate(tx.date)} {tx.date && `• ${formatTime(tx.date)}`}
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 shrink-0 rounded-full"
                          onClick={() => setSelectedTransaction(tx)}
                          data-testid={`button-print-${tx.id}`}
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-muted-foreground/50 hover:text-destructive shrink-0"
                          onClick={() => handleDelete(tx.id)}
                          disabled={deleteTransaction.isPending}
                          data-testid={`button-delete-${tx.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-10 bg-muted/20 rounded-2xl border border-dashed border-border/50">
                  <Search className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
                  <p className="text-muted-foreground font-medium">لا توجد معاملات</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    {searchQuery || walletFilter !== "all" || categoryFilter !== "all" || rangeFilter !== "all" ? "جرّب تغيير الفلاتر أو كلمات البحث" : "أضف معاملتك الأولى بالضغط على زر +"}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!selectedTransaction} onOpenChange={(open) => !open && setSelectedTransaction(null)}>
        <DialogContent dir="rtl" className="max-w-[calc(100vw-1rem)] overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="hide-on-print px-4 pt-5 text-right sm:px-6 sm:pt-6">
            <DialogTitle>فاتورة المعاملة</DialogTitle>
            <DialogDescription>
              راجع تفاصيل المعاملة ثم اطبعها أو احفظها كملف PDF بنفس تنسيق الفاتورة.
            </DialogDescription>
          </DialogHeader>

          <div className="hide-on-print flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="text-sm text-muted-foreground">
              {selectedTransaction ? `رقم العملية: #${selectedTransaction.id}` : ""}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setSelectedTransaction(null)}>
                إغلاق
              </Button>
              <Button type="button" className="w-full sm:w-auto" onClick={handlePrintInvoice}>
                <Printer className="h-4 w-4" />
                طباعة / PDF
              </Button>
            </div>
          </div>

          <div className="overflow-y-auto bg-muted/20 p-3 sm:p-6" style={{ maxHeight: "calc(var(--app-viewport-height, 100vh) * 0.8)" }}>
            {selectedTransaction ? (
              <div className="print-report-root mx-auto max-w-3xl space-y-4 rounded-[28px] bg-background p-4 sm:space-y-6 sm:rounded-3xl sm:p-8">
                <div className="print-break-avoid rounded-[28px] border bg-card p-4 sm:rounded-3xl sm:p-6">
                  <div className="flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2 text-right">
                      <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
                        <Receipt className="h-3.5 w-3.5" />
                        مستند معاملة مالي
                      </div>
                      <h2 className="text-xl font-bold sm:text-2xl">فاتورة معاملة</h2>
                      <p className="text-sm text-muted-foreground">تفاصيل واضحة للطباعة والمشاركة والحفظ بصيغة PDF</p>
                    </div>
                    <div className="text-right text-sm text-muted-foreground sm:text-left">
                      <p>رقم العملية: #{selectedTransaction.id}</p>
                      <p>تاريخ الإنشاء: {new Date().toLocaleString("ar-OM")}</p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border p-4">
                      <p className="text-xs text-muted-foreground">نوع العملية</p>
                      <p className="mt-2 font-semibold">{getTransactionTypeLabel(selectedTransaction.type, selectedTransaction.note)}</p>
                    </div>
                    <div className="rounded-2xl border p-4">
                      <p className="text-xs text-muted-foreground">المبلغ</p>
                      <p className={cn("mt-2 text-lg font-bold", selectedTransaction.type === "income" ? "text-emerald-600" : "text-red-600")}>
                        {selectedTransaction.type === "income" ? "+" : "-"}{formatCurrency(selectedTransaction.amount, 2)}
                      </p>
                    </div>
                    <div className="rounded-2xl border p-4">
                      <p className="text-xs text-muted-foreground">التصنيف</p>
                      <p className="mt-2 font-semibold">{isTransferTransaction(selectedTransaction.note) ? "تحويل" : selectedTransaction.categoryName || "بدون تصنيف"}</p>
                    </div>
                    <div className="rounded-2xl border p-4">
                      <p className="text-xs text-muted-foreground">المحفظة / وسيلة الدفع</p>
                      <p className="mt-2 font-semibold">{selectedTransaction.walletName || "بدون محفظة"}</p>
                    </div>
                  </div>
                </div>

                <div className="print-break-avoid rounded-[28px] border bg-card p-4 sm:rounded-3xl sm:p-6">
                  <h3 className="text-lg font-bold">تفاصيل الفاتورة</h3>
                  <div className="mt-4 overflow-hidden rounded-3xl border">
                    <div className="grid grid-cols-2 border-b bg-muted/40 text-sm font-medium">
                      <div className="border-l px-4 py-3">البيان</div>
                      <div className="px-4 py-3">القيمة</div>
                    </div>
                    {[
                      ["التاريخ", `${formatRelativeArabicDate(selectedTransaction.date)} • ${formatTime(selectedTransaction.date)}`],
                      ["الوصف", getTransferLabel(selectedTransaction.note) || "بدون وصف"],
                      ["التصنيف", isTransferTransaction(selectedTransaction.note) ? "تحويل بين المحافظ" : selectedTransaction.categoryName || "بدون تصنيف"],
                      ["المحفظة", selectedTransaction.walletName || "بدون محفظة"],
                    ].map(([label, value]) => (
                      <div key={label} className="grid grid-cols-2 border-b last:border-b-0 text-sm">
                        <div className="border-l bg-background px-4 py-3 font-medium">{label}</div>
                        <div className="px-4 py-3 text-muted-foreground">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="print-break-avoid rounded-[28px] border bg-card p-4 sm:rounded-3xl sm:p-6">
                  <h3 className="text-lg font-bold">ملخص المبلغ</h3>
                  <div className="mt-4 rounded-3xl border p-4">
                    <div className="flex items-center justify-between gap-3 border-b pb-3 text-sm">
                      <span className="text-muted-foreground">قيمة العملية</span>
                      <span className={cn("font-bold", selectedTransaction.type === "income" ? "text-emerald-600" : "text-red-600")}>
                        {selectedTransaction.type === "income" ? "+" : "-"}{formatCurrency(selectedTransaction.amount, 2)}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 text-base font-bold">
                      <span>الإجمالي النهائي</span>
                      <span><CurrencyDisplay amount={selectedTransaction.amount} fractionDigits={2} /></span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
