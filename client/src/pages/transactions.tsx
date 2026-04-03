import { Filter, Search, Calendar, Loader2, Trash2, Wallet, PieChart, ArrowLeftRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, formatRelativeArabicDate, formatTime, normalizeArabicText, toDate } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMemo, useState } from "react";
import { useTransactions, useDeleteTransaction, useWallets, useCategories } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";

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

export default function Transactions() {
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [walletFilter, setWalletFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [rangeFilter, setRangeFilter] = useState<"all" | "7days" | "30days" | "90days">("all");
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
    <div className="flex flex-col h-full bg-background animate-in fade-in duration-300">
      <header className="px-4 py-6 pb-4 bg-background sticky top-0 z-10 border-b border-border/50">
        <h1 className="text-2xl font-bold mb-4">المعاملات</h1>
        
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
          <TabsList className="w-full h-auto p-1 bg-muted/50 rounded-xl grid grid-cols-4">
            <TabsTrigger value="all" className="rounded-lg py-2 text-xs" data-testid="tab-all">الكل</TabsTrigger>
            <TabsTrigger value="income" className="rounded-lg py-2 text-xs" data-testid="tab-income">دخل</TabsTrigger>
            <TabsTrigger value="expense" className="rounded-lg py-2 text-xs" data-testid="tab-expense">صرف</TabsTrigger>
            <TabsTrigger value="debt" className="rounded-lg py-2 text-xs" data-testid="tab-debt">ديون</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-3 gap-2 mt-4">
          <select value={walletFilter} onChange={(e) => setWalletFilter(e.target.value)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none">
            <option value="all">كل المحافظ</option>
            {wallets.map((wallet) => (
              <option key={wallet.id} value={wallet.id.toString()}>{wallet.name}</option>
            ))}
          </select>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none">
            <option value="all">كل الأقسام</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id.toString()}>{category.name}</option>
            ))}
          </select>
          <select value={rangeFilter} onChange={(e) => setRangeFilter(e.target.value as typeof rangeFilter)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none">
            <option value="all">كل الفترات</option>
            <option value="7days">آخر 7 أيام</option>
            <option value="30days">آخر 30 يومًا</option>
            <option value="90days">آخر 90 يومًا</option>
          </select>
        </div>
      </header>

      <div className="p-4 flex-1 overflow-auto pb-24">
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-2xl p-4 border border-emerald-100 dark:border-emerald-900/50">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-sm font-medium mb-1">
              <ArrowLeftRight className="h-4 w-4" />
              إجمالي الدخل
            </div>
            <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">+{formatCurrency(totalIncome, 2)}</p>
          </div>
          <div className="bg-red-50 dark:bg-red-950/20 rounded-2xl p-4 border border-red-100 dark:border-red-900/50">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400 text-sm font-medium mb-1">
              <Filter className="h-4 w-4" />
              إجمالي الخروج
            </div>
            <p className="text-xl font-bold text-red-700 dark:text-red-300">-{formatCurrency(totalOutflow, 2)}</p>
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
            <div className="flex flex-col gap-3">
              {filteredTransactions.length > 0 ? (
                filteredTransactions.map((tx) => {
                  const isTransfer = isTransferTransaction(tx.note);
                  const catName = isTransfer ? "تحويل" : tx.categoryName || "أخرى";
                  const icon = tx.categoryIcon || defaultIcons[catName] || "📝";
                  const bg = defaultBgs[catName] || "bg-muted";
                  return (
                    <div key={tx.id} className="bg-card p-3.5 rounded-2xl border border-border/50 shadow-sm flex items-center justify-between active-elevate transition-all" data-testid={`card-transaction-${tx.id}`}>
                      <div className="flex items-center gap-3">
                        <div className={cn("h-12 w-12 rounded-2xl flex items-center justify-center text-xl shrink-0", bg)}>
                          {icon}
                        </div>
                        <div>
                          <h4 className="font-bold text-sm">{catName}</h4>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{getTransferLabel(tx.note)}</p>
                          <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                            {tx.walletName ? <span className="inline-flex items-center gap-1"><Wallet className="h-3 w-3" />{tx.walletName}</span> : null}
                            {tx.categoryName ? <span className="inline-flex items-center gap-1"><PieChart className="h-3 w-3" />{tx.categoryName}</span> : null}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col items-end">
                          <span className={cn(
                            "font-bold",
                            tx.type === 'income' ? "text-emerald-500" : 
                            tx.type === 'expense' ? "text-red-500" :
                            "text-gray-900 dark:text-gray-100"
                          )}>
                            {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount, 2)}
                          </span>
                          <span className="text-[10px] text-muted-foreground mt-1">
                            {tx.date && formatRelativeArabicDate(tx.date)} {tx.date && `• ${formatTime(tx.date)}`}
                          </span>
                        </div>
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
    </div>
  );
}
