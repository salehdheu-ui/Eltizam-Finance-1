import { Filter, Search, Calendar, Loader2, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import { useTransactions, useDeleteTransaction } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";

function formatDate(date: string | Date) {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "اليوم";
  if (days === 1) return "أمس";
  return d.toLocaleDateString("ar-OM", { day: "numeric", month: "long" });
}

function formatTime(date: string | Date) {
  return new Date(date).toLocaleTimeString("ar-OM", { hour: "2-digit", minute: "2-digit" });
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
  const { data: transactions, isLoading } = useTransactions();
  const deleteTransaction = useDeleteTransaction();
  const { toast } = useToast();

  const filteredTransactions = (transactions || []).filter((tx) => {
    if (activeTab !== "all" && tx.type !== activeTab) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        (tx.categoryName || "").toLowerCase().includes(q) ||
        (tx.note || "").toLowerCase().includes(q) ||
        tx.amount.toString().includes(q)
      );
    }
    return true;
  });

  const handleDelete = async (id: number) => {
    try {
      await deleteTransaction.mutateAsync(id);
      toast({ title: "تم الحذف", description: "تم حذف المعاملة بنجاح" });
    } catch {
      toast({ title: "خطأ", description: "فشل حذف المعاملة", variant: "destructive" });
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
      </header>

      <div className="p-4 flex-1 overflow-auto pb-24">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>جميع المعاملات</span>
            </div>
            {searchQuery && (
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
                  const catName = tx.categoryName || "أخرى";
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
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{tx.note}</p>
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
                            {tx.type === 'income' ? '+' : '-'}{tx.amount.toFixed(2)}
                          </span>
                          <span className="text-[10px] text-muted-foreground mt-1">
                            {tx.date && formatDate(tx.date)} {tx.date && `• ${formatTime(tx.date)}`}
                          </span>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-muted-foreground/50 hover:text-destructive shrink-0"
                          onClick={() => handleDelete(tx.id)}
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
                    {searchQuery ? "جرب تغيير كلمات البحث أو الفلتر" : "أضف معاملتك الأولى بالضغط على زر +"}
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
