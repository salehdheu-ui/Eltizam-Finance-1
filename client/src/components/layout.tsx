import { Link, useLocation } from "wouter";
import { Home, ListFilter, Wallet, PieChart, Plus, Settings, Loader2, BarChart3, Menu, X, ChevronLeft, Receipt } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "./ui/button";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { useCategories, useWallets, useCreateTransaction, useUser, useObligation, useVariableObligationStatuses } from "@/lib/hooks";

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function formatMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getDefaultMonthStatus(monthDate: Date) {
  const currentMonth = startOfMonth(new Date());
  return monthDate < currentMonth ? "late" : "unpaid";
}

interface LayoutProps {
  children: React.ReactNode;
}

type AddTransactionDetail = {
  type?: string;
  amount?: string;
  note?: string;
  categoryId?: string;
  walletId?: string;
  obligationId?: string;
  obligationScheduleType?: string;
};

export default function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { toast } = useToast();
  
  const [isAddTxOpen, setIsAddTxOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [txType, setTxType] = useState("expense");
  const [txAmount, setTxAmount] = useState("");
  const [txNote, setTxNote] = useState("");
  const [txCategoryId, setTxCategoryId] = useState("");
  const [txWalletId, setTxWalletId] = useState("");
  const [sourceObligationId, setSourceObligationId] = useState("");
  const [sourceObligationScheduleType, setSourceObligationScheduleType] = useState("");
  const sourceObligationNumericId = sourceObligationId ? parseInt(sourceObligationId, 10) : undefined;

  const { data: categoriesData } = useCategories();
  const { data: walletsData } = useWallets();
  const { data: user } = useUser();
  const { data: sourceObligation } = useObligation(sourceObligationNumericId);
  const { data: sourceObligationStatuses = [] } = useVariableObligationStatuses(sourceObligationNumericId);
  const createTransaction = useCreateTransaction();
  const isSystemAdmin = user?.role === "system_admin";

  const categories = categoriesData || [];
  const wallets = walletsData || [];
  const filteredCategories = categories.filter(c => c.type === txType);
  const isVariableObligationQuickPay = sourceObligationScheduleType === "variable" && txType === "expense" && !!sourceObligation;
  const remainingVariableMonths = sourceObligation && sourceObligation.scheduleType === "variable"
    ? (() => {
        const startDate = startOfMonth(new Date(sourceObligation.startDate * 1000));
        const minimumEnd = addMonths(startOfMonth(new Date()), 23);
        const explicitEnd = sourceObligation.endDate ? startOfMonth(new Date(sourceObligation.endDate * 1000)) : minimumEnd;
        const endDate = explicitEnd > minimumEnd ? explicitEnd : minimumEnd;
        const paidMonths = new Set(
          sourceObligationStatuses.filter((item) => item.status === "paid").map((item) => item.monthKey),
        );
        const months: string[] = [];

        for (let cursor = new Date(startDate); cursor <= endDate; cursor = addMonths(cursor, 1)) {
          const monthKey = formatMonthKey(cursor);
          const savedStatus = sourceObligationStatuses.find((item) => item.monthKey === monthKey)?.status ?? getDefaultMonthStatus(cursor);
          if (savedStatus !== "paid" && !paidMonths.has(monthKey)) {
            months.push(monthKey);
          }
        }

        return months;
      })()
    : [];
  const quickPayAmountOptions = isVariableObligationQuickPay && sourceObligation
    ? remainingVariableMonths.slice(0, 12).map((_, index) => {
        const monthsCount = index + 1;
        return {
          monthsCount,
          amount: Number((sourceObligation.amount * monthsCount).toFixed(3)),
        };
      })
    : [];

  useEffect(() => {
    const handleOpenAddTransaction = (event: Event) => {
      const customEvent = event as CustomEvent<AddTransactionDetail | undefined>;
      const detail = customEvent.detail;

      if (detail) {
        setTxType(detail.type ?? "expense");
        setTxAmount(detail.amount ?? "");
        setTxNote(detail.note ?? "");
        setTxCategoryId(detail.categoryId ?? "");
        setTxWalletId(detail.walletId ?? "");
        setSourceObligationId(detail.obligationId ?? "");
        setSourceObligationScheduleType(detail.obligationScheduleType ?? "");
      } else {
        setTxType("expense");
        setTxAmount("");
        setTxNote("");
        setTxCategoryId("");
        setTxWalletId("");
        setSourceObligationId("");
        setSourceObligationScheduleType("");
      }

      setIsAddTxOpen(true);
    };

    window.addEventListener('open-add-transaction', handleOpenAddTransaction as EventListener);
    return () => window.removeEventListener('open-add-transaction', handleOpenAddTransaction);
  }, []);

  useEffect(() => {
    if (isVariableObligationQuickPay) {
      const matchingOption = quickPayAmountOptions.find((option) => option.amount.toString() === txAmount);
      if (!matchingOption && quickPayAmountOptions.length > 0) {
        setTxAmount(quickPayAmountOptions[0].amount.toString());
      }
      if (quickPayAmountOptions.length === 0) {
        setTxAmount("");
      }
    }
  }, [isVariableObligationQuickPay, quickPayAmountOptions, txAmount]);

  // Main bottom navigation (most important)
  const mainNavItems = [
    { href: "/", icon: Home, label: "الرئيسية" },
    { href: "/transactions", icon: ListFilter, label: "المعاملات" },
    { href: "/reports", icon: BarChart3, label: "التقارير" },
  ];

  // Sidebar navigation (less frequently used)
  const sidebarItems = [
    { href: "/wallets", icon: Wallet, label: "المحافظ" },
    { href: "/obligations", icon: Receipt, label: "الالتزامات" },
    { href: "/categories", icon: PieChart, label: "الأقسام" },
    { href: "/settings", icon: Settings, label: "الإعدادات" },
    ...(isSystemAdmin ? [{ href: "/admin/users", icon: Settings, label: "إدارة المستخدمين" }] : []),
  ];

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!txAmount) {
      toast({ title: "خطأ", description: "يجب إدخال المبلغ", variant: "destructive" });
      return;
    }
    if (!txWalletId) {
      toast({ title: "خطأ", description: "يجب اختيار محفظة أو بنك", variant: "destructive" });
      return;
    }
    
    try {
      const parsedAmount = parseFloat(txAmount);
      if (isVariableObligationQuickPay && !quickPayAmountOptions.some((option) => option.amount === parsedAmount)) {
        toast({ title: "خطأ", description: "اختر مبلغًا من الخيارات الجاهزة لهذا الالتزام", variant: "destructive" });
        return;
      }

      await createTransaction.mutateAsync({
        type: txType,
        amount: parsedAmount,
        note: txNote || "",
        categoryId: txCategoryId ? parseInt(txCategoryId) : null,
        walletId: parseInt(txWalletId),
      });

      let allocationDescription = "";

      if (sourceObligationId && sourceObligationScheduleType === "variable" && txType === "expense") {
        const response = await apiRequest("POST", `/api/obligations/${sourceObligationId}/apply-variable-payment`, {
          amount: parsedAmount,
        });
        const result = await response.json() as { allocatedMonths: number };

        await queryClient.invalidateQueries({ queryKey: ["/api/obligations"] });
        await queryClient.invalidateQueries({ queryKey: ["/api/obligations", Number(sourceObligationId)] });
        await queryClient.invalidateQueries({ queryKey: ["/api/obligations", Number(sourceObligationId), "variable-statuses"] });

        if (result.allocatedMonths > 0) {
          allocationDescription = ` وربطنا ${result.allocatedMonths} شهر بالتسلسل`;
        }
      }
      
      toast({
        title: "تمت الإضافة بنجاح",
        description: `تم تسجيل ${txType === 'expense' ? 'مصروف' : txType === 'income' ? 'دخل' : 'دين'} بقيمة ${txAmount} ر.ع${allocationDescription}`,
      });
      
      setIsAddTxOpen(false);
      setTxAmount("");
      setTxNote("");
      setTxCategoryId("");
      setTxWalletId("");
      setSourceObligationId("");
      setSourceObligationScheduleType("");
      setTxType("expense");
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || "فشل إضافة المعاملة";
      toast({ title: "خطأ", description: message, variant: "destructive" });
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-muted/30 pb-20">
      {/* Header with menu button */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="flex items-center h-14 px-4 w-full max-w-md mx-auto relative" dir="rtl">
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-10 w-10 rounded-full z-10"
            onClick={() => setIsSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold absolute left-1/2 transform -translate-x-1/2">التزام</h1>
        </div>
      </header>

      {/* Sidebar Drawer */}
      <div className={cn(
        "fixed inset-0 z-50 transition-all duration-300",
        isSidebarOpen ? "visible" : "invisible"
      )}>
        {/* Backdrop */}
        <div 
          className={cn(
            "absolute inset-0 bg-black/50 transition-opacity duration-300",
            isSidebarOpen ? "opacity-100" : "opacity-0"
          )}
          onClick={() => setIsSidebarOpen(false)}
        />
        
        {/* Sidebar Content */}
        <div className={cn(
          "absolute top-0 right-0 h-full w-72 bg-background shadow-2xl transition-transform duration-300 ease-out",
          isSidebarOpen ? "translate-x-0" : "translate-x-full"
        )} dir="rtl">
          <div className="flex flex-col h-full">
            {/* Sidebar Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-lg font-bold">القائمة</h2>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-9 w-9 rounded-full"
                onClick={() => setIsSidebarOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Sidebar Items */}
            <nav className="flex-1 p-4 space-y-2">
              {sidebarItems.map((item) => {
                const isActive = location === item.href;
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      onClick={() => setIsSidebarOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer",
                        isActive 
                          ? "bg-primary text-primary-foreground font-medium" 
                          : "hover:bg-muted text-foreground"
                      )}
                    >
                      <Icon className={cn("h-5 w-5 flex-shrink-0", isActive && "stroke-[2.5]")} />
                      <span className="flex-1 text-right">{item.label}</span>
                      <ChevronLeft className={cn(
                        "h-4 w-4 flex-shrink-0",
                        isActive ? "opacity-100" : "opacity-40"
                      )} />
                    </div>
                  </Link>
                );
              })}
            </nav>

            {/* Sidebar Footer */}
            <div className="p-4 border-t border-border">
              <div className="text-xs text-muted-foreground text-center">
                التزام - نظام المالية الشخصية
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-md mx-auto relative pt-14">
        {children}
        
        <div className="fixed bottom-24 left-6 z-40">
          <Button 
            size="icon" 
            className="h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-all shadow-primary/30 bg-primary text-primary-foreground cursor-pointer"
            onClick={() => setIsAddTxOpen(true)}
            data-testid="button-add-transaction"
          >
            <Plus className="h-6 w-6" strokeWidth={2.5} />
          </Button>
        </div>
      </main>

      {/* Simplified Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-background border-t border-border shadow-[0_-4px_20px_rgba(0,0,0,0.05)] pb-safe">
        <div className="flex items-center justify-around h-16 w-full max-w-md mx-auto px-4 relative">
          {mainNavItems.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex flex-col items-center justify-center min-w-[70px] h-full gap-1.5 cursor-pointer transition-colors duration-200",
                    isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid={`nav-${item.href === '/' ? 'home' : item.href.slice(1)}`}
                >
                  <div className={cn(
                    "flex items-center justify-center w-10 h-10 rounded-xl transition-all",
                    isActive ? "bg-primary/10" : ""
                  )}>
                    <Icon className={cn("h-5 w-5", isActive && "stroke-[2.5]")} />
                  </div>
                  <span className="text-[10px] font-medium whitespace-nowrap">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <Drawer open={isAddTxOpen} onOpenChange={setIsAddTxOpen}>
        <DrawerContent dir="rtl">
          <div className="mx-auto flex w-full max-w-sm min-h-0 flex-1 flex-col">
            <DrawerHeader className="shrink-0 pb-3">
              <DrawerTitle className="text-xl">إضافة معاملة جديدة</DrawerTitle>
              <DrawerDescription className="text-sm leading-6">سجل تفاصيل الدخل، المصروف، أو الدين بشكل واضح وسريع.</DrawerDescription>
            </DrawerHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <form onSubmit={handleAddTransaction} className="flex flex-col gap-5 pb-2">
              <div className="flex bg-muted/60 p-1 rounded-2xl border border-border/50 shadow-sm">
                {["expense", "income", "debt"].map((type) => (
                  <button key={type} type="button" onClick={() => { setTxType(type); setTxCategoryId(""); }}
                    className={cn("flex-1 py-2.5 text-sm rounded-xl transition-all",
                      txType === type ? "bg-background shadow-sm font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}>
                    {type === 'expense' ? 'مصروف' : type === 'income' ? 'دخل' : 'دين'}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="tx-amount" className="text-base font-semibold">المبلغ (ر.ع)</Label>
                {isVariableObligationQuickPay ? (
                  <div className="rounded-2xl border border-primary/15 bg-gradient-to-b from-primary/5 to-background p-4 shadow-sm space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">اختيار مبلغ الدفعة</p>
                        <p className="text-xs leading-5 text-muted-foreground">اختر من القائمة داخل هذا المستطيل حسب عدد الأشهر التي تريد دفعها.</p>
                      </div>
                      <div className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                        {quickPayAmountOptions.length} خيارات
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border/60 bg-background px-4 py-3 shadow-sm space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs text-muted-foreground">المبلغ المحدد</p>
                          <p className="text-xl font-bold text-foreground">{txAmount ? `${formatCurrency(Number(txAmount))} ر.ع` : "-"}</p>
                        </div>
                        <div className="text-left text-xs text-muted-foreground">
                          {quickPayAmountOptions.find((option) => option.amount.toString() === txAmount)?.monthsCount ?? 0} أشهر
                        </div>
                      </div>

                      <select
                        id="tx-amount"
                        value={txAmount}
                        onChange={(e) => setTxAmount(e.target.value)}
                        className="h-12 w-full rounded-xl border border-border bg-background px-3 text-sm text-right shadow-sm outline-none focus:border-primary"
                        required
                      >
                        {quickPayAmountOptions.map((option) => (
                          <option key={option.monthsCount} value={option.amount.toString()}>
                            {formatCurrency(option.amount)} ر.ع - {option.monthsCount} {option.monthsCount === 1 ? "شهر" : "أشهر"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <Input id="tx-amount" type="number" placeholder="0.00" value={txAmount} onChange={(e) => setTxAmount(e.target.value)} className="text-right text-lg h-14 rounded-2xl shadow-sm" required step="0.01" />
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="tx-note" className="text-base font-semibold">ملاحظة</Label>
                <Input id="tx-note" placeholder="مثال: قسط، إيجار، دفعة شهرية..." value={txNote} onChange={(e) => setTxNote(e.target.value)} className="text-right h-14 rounded-2xl shadow-sm" />
              </div>

              {filteredCategories.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Label className="text-base font-semibold">القسم</Label>
                  <div className="flex flex-wrap gap-2">
                    {filteredCategories.map((cat) => (
                      <button key={cat.id} type="button" onClick={() => setTxCategoryId(cat.id.toString())}
                        className={cn("px-3 py-2 rounded-full text-sm border transition-all flex items-center gap-1.5 shadow-sm",
                          txCategoryId === cat.id.toString() ? "border-primary bg-primary/10 text-primary font-medium" : "border-border/50 hover:bg-muted/50"
                        )}>
                        <span>{cat.icon}</span>
                        <span>{cat.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label className="flex items-center gap-1 text-base font-semibold">
                  المحفظة
                  <span className="text-destructive">*</span>
                </Label>
                {wallets.length === 0 ? (
                  <div className="p-3 rounded-2xl bg-destructive/10 text-destructive text-sm text-center">
                    لا توجد محافظ. يجب إنشاء محفظة أولاً من صفحة المحافظ
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {wallets.map((w) => (
                      <button key={w.id} type="button" onClick={() => setTxWalletId(w.id.toString())}
                        className={cn("px-3 py-2 rounded-full text-sm border transition-all shadow-sm",
                          txWalletId === w.id.toString() ? "border-primary bg-primary/10 text-primary font-medium" : "border-border/50 hover:bg-muted/50"
                        )}>
                        {w.name}
                      </button>
                    ))}
                  </div>
                )}
                {txWalletId && (
                  <p className="text-xs text-emerald-600">✓ تم اختيار المحفظة</p>
                )}
              </div>
            </form>
            </div>

            <DrawerFooter className="shrink-0 border-t border-border/50 bg-background/95 pt-4 pb-5 backdrop-blur">
              <Button onClick={handleAddTransaction} className="w-full h-14 rounded-2xl text-base shadow-lg shadow-primary/20" disabled={createTransaction.isPending}>
                {createTransaction.isPending ? (
                  <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /><span>جاري الحفظ...</span></div>
                ) : "حفظ المعاملة"}
              </Button>
              <DrawerClose asChild>
                <Button variant="outline" className="w-full h-14 rounded-2xl">إلغاء</Button>
              </DrawerClose>
            </DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
