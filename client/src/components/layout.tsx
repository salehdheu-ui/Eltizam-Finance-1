import { Link, useLocation } from "wouter";
import { Home, ListFilter, Wallet, PieChart, Plus, Settings, Loader2, BarChart3, Menu, X, ChevronLeft, Receipt, Landmark, LogOut, PiggyBank } from "lucide-react";
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
import { ApiError, apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { useCategories, useWallets, useCreateTransaction, useUser, useObligation, useVariableObligationStatuses, useLogout } from "@/lib/hooks";

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

type TransactionKind = "expense" | "income" | "debt" | "transfer";

type AddTransactionDetail = {
  type?: TransactionKind;
  amount?: string;
  note?: string;
  categoryId?: string;
  walletId?: string;
  targetWalletId?: string;
  obligationId?: string;
  obligationScheduleType?: string;
};

function blurActiveElement() {
  if (typeof document === "undefined") {
    return;
  }

  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement) {
    activeElement.blur();
  }
}

export default function Layout({ children }: LayoutProps) {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [isAddTxOpen, setIsAddTxOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [txType, setTxType] = useState<TransactionKind>("expense");
  const [txAmount, setTxAmount] = useState("");
  const [txNote, setTxNote] = useState("");
  const [txCategoryId, setTxCategoryId] = useState("");
  const [txWalletId, setTxWalletId] = useState("");
  const [txTargetWalletId, setTxTargetWalletId] = useState("");
  const [sourceObligationId, setSourceObligationId] = useState("");
  const [sourceObligationScheduleType, setSourceObligationScheduleType] = useState("");
  const sourceObligationNumericId = sourceObligationId ? parseInt(sourceObligationId, 10) : undefined;

  const { data: categoriesData } = useCategories();
  const { data: walletsData } = useWallets();
  const { data: user } = useUser();
  const { data: sourceObligation } = useObligation(sourceObligationNumericId);
  const { data: sourceObligationStatuses = [] } = useVariableObligationStatuses(sourceObligationNumericId);
  const createTransaction = useCreateTransaction();
  const logoutMutation = useLogout();
  const isSubmittingTransaction = createTransaction.isPending;
  const isSystemAdmin = user?.role === "system_admin";

  const categories = categoriesData || [];
  const wallets = walletsData || [];
  const filteredCategories = txType === "transfer" ? [] : categories.filter(c => c.type === txType);
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
        setTxTargetWalletId(detail.targetWalletId ?? "");
        setSourceObligationId(detail.obligationId ?? "");
        setSourceObligationScheduleType(detail.obligationScheduleType ?? "");
      } else {
        setTxType("expense");
        setTxAmount("");
        setTxNote("");
        setTxCategoryId("");
        setTxWalletId("");
        setTxTargetWalletId("");
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

  useEffect(() => {
    if (!isAddTxOpen) {
      blurActiveElement();
      requestAnimationFrame(() => window.scrollTo({ top: window.scrollY, behavior: "instant" as ScrollBehavior }));
    }
  }, [isAddTxOpen]);

  // Main bottom navigation (most important)
  const mainNavItems = [
    { href: "/", icon: Home, label: "الرئيسية" },
    { href: "/transactions", icon: ListFilter, label: "المعاملات" },
    { href: "/reports", icon: BarChart3, label: "التقارير" },
  ];

  // Sidebar navigation (less frequently used)
  const sidebarItems = [
    { href: "/income", icon: Landmark, label: "الدخل والراتب" },
    { href: "/wallets", icon: Wallet, label: "المحافظ" },
    { href: "/financial-plans", icon: PiggyBank, label: "خطط الادخار" },
    { href: "/obligations", icon: Receipt, label: "الالتزامات" },
    { href: "/categories", icon: PieChart, label: "الأقسام" },
    { href: "/settings", icon: Settings, label: "الإعدادات" },
    ...(isSystemAdmin ? [{ href: "/admin/users", icon: Settings, label: "إدارة المستخدمين" }] : []),
  ];

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
      setIsSidebarOpen(false);
      setLocation("/login");
    } catch {
      setIsSidebarOpen(false);
      setLocation("/login");
    }
  };

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingTransaction) {
      return;
    }
    if (!txAmount) {
      toast({ title: "خطأ", description: "يجب إدخال المبلغ", variant: "destructive" });
      return;
    }
    if (!txWalletId) {
      toast({ title: "خطأ", description: "يجب اختيار محفظة أو بنك", variant: "destructive" });
      return;
    }
    if (txType === "transfer" && !txTargetWalletId) {
      toast({ title: "خطأ", description: "يجب اختيار المحفظة المحوَّل إليها", variant: "destructive" });
      return;
    }
    if (txType === "transfer" && txWalletId === txTargetWalletId) {
      toast({ title: "خطأ", description: "يجب اختيار محفظتين مختلفتين للتحويل", variant: "destructive" });
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
        categoryId: txType === "transfer" ? null : txCategoryId ? parseInt(txCategoryId) : null,
        walletId: parseInt(txWalletId),
        targetWalletId: txType === "transfer" ? parseInt(txTargetWalletId, 10) : null,
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
        description: txType === "transfer"
          ? `تم تحويل ${txAmount} ر.ع بنجاح بين المحافظ`
          : `تم تسجيل ${txType === 'expense' ? 'مصروف' : txType === 'income' ? 'دخل' : 'دين'} بقيمة ${txAmount} ر.ع${allocationDescription}`,
      });

      blurActiveElement();
      
      setIsAddTxOpen(false);
      setTxAmount("");
      setTxNote("");
      setTxCategoryId("");
      setTxWalletId("");
      setTxTargetWalletId("");
      setSourceObligationId("");
      setSourceObligationScheduleType("");
      setTxType("expense");
    } catch (error) {
      const message = error instanceof Error ? error.message : "فشل إضافة المعاملة";
      const queueWaitMessage = error instanceof ApiError && error.queueWaitMs && error.queueWaitMs >= 1000
        ? ` بعد انتظار ${Math.ceil(error.queueWaitMs / 1000)} ثانية في طابور الحفظ`
        : "";
      toast({ title: "خطأ", description: message, variant: "destructive" });
      if (queueWaitMessage) {
        toast({ title: "معلومة", description: `تمت معالجة طلبك${queueWaitMessage}. يمكنك إعادة المحاولة الآن.` });
      }
    }
  };

  return (
    <div className="app-min-h-screen flex flex-col overflow-x-hidden bg-muted/30 pb-20 lg:pb-0">
      {/* Header with menu button */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="relative mx-auto flex h-14 w-full max-w-7xl items-center px-4 sm:px-6 lg:px-8" dir="rtl">
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-10 w-10 rounded-full z-10"
            onClick={() => setIsSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-bold">التزام</h1>
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
          "absolute top-0 right-0 h-full w-[min(22rem,calc(100vw-1.5rem))] bg-background shadow-2xl transition-transform duration-300 ease-out sm:w-80",
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
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 rounded-xl px-4 py-6 text-base text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
                onClick={handleLogout}
                disabled={logoutMutation.isPending}
              >
                {logoutMutation.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <LogOut className="h-5 w-5" />
                )}
                <span className="flex-1 text-right">تسجيل الخروج</span>
              </Button>
              <div className="text-xs text-muted-foreground text-center">
                التزام - نظام المالية الشخصية
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="relative flex-1 pt-14">
        <div className="mx-auto w-full max-w-7xl px-3 sm:px-4 lg:px-8">
          {children}
        </div>
        
        <div className="fixed bottom-[5.5rem] left-3 z-40 sm:bottom-24 sm:left-6 lg:bottom-8 lg:left-8 xl:left-[max(2rem,calc((100vw-80rem)/2+2rem))]">
          <Button 
            size="icon" 
            className="h-12 w-12 rounded-full shadow-lg hover:shadow-xl transition-all shadow-primary/30 bg-primary text-primary-foreground cursor-pointer sm:h-14 sm:w-14"
            onClick={() => setIsAddTxOpen(true)}
            data-testid="button-add-transaction"
          >
            <Plus className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.5} />
          </Button>
        </div>
      </main>

      {/* Simplified Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background shadow-[0_-4px_20px_rgba(0,0,0,0.05)] pb-safe lg:border-t-0 lg:bg-transparent lg:shadow-none">
        <div className="relative mx-auto flex h-16 w-full max-w-7xl items-center justify-around px-4 sm:px-6 lg:max-w-fit lg:justify-center lg:gap-4 lg:rounded-2xl lg:border lg:border-border/70 lg:bg-background/95 lg:px-5 lg:shadow-lg lg:backdrop-blur xl:px-6">
          {mainNavItems.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex h-full min-w-[70px] cursor-pointer flex-col items-center justify-center gap-1.5 transition-colors duration-200 lg:min-w-[88px] lg:flex-row lg:gap-2 lg:px-3",
                    isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid={`nav-${item.href === '/' ? 'home' : item.href.slice(1)}`}
                >
                  <div className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-xl transition-all",
                    isActive ? "bg-primary/10" : ""
                  )}>
                    <Icon className={cn("h-5 w-5", isActive && "stroke-[2.5]")} />
                  </div>
                  <span className="whitespace-nowrap text-[10px] font-medium lg:text-xs">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <Drawer open={isAddTxOpen} onOpenChange={(open) => {
        if (!open) {
          blurActiveElement();
        }
        setIsAddTxOpen(open);
      }}>
        <DrawerContent dir="rtl">
          <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
            <DrawerHeader className="shrink-0 pb-3">
              <DrawerTitle className="text-xl">إضافة معاملة جديدة</DrawerTitle>
              <DrawerDescription className="text-sm leading-6">سجل تفاصيل الدخل، المصروف، أو الدين بشكل واضح وسريع.</DrawerDescription>
            </DrawerHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <form onSubmit={handleAddTransaction} className="flex flex-col gap-5 pb-2">
              <div className="flex bg-muted/60 p-1 rounded-2xl border border-border/50 shadow-sm">
                {(["expense", "income", "debt", "transfer"] as TransactionKind[]).map((type) => (
                  <button key={type} type="button" onClick={() => { setTxType(type); setTxCategoryId(""); if (type !== "transfer") setTxTargetWalletId(""); }}
                    className={cn("flex-1 py-2.5 text-sm rounded-xl transition-all",
                      txType === type ? "bg-background shadow-sm font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}>
                    {type === 'expense' ? 'مصروف' : type === 'income' ? 'دخل' : type === 'transfer' ? 'تحويل' : 'دين'}
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
                  {txType === "transfer" ? "التحويل من" : "المحفظة"}
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
              {txType === "transfer" && (
                <div className="flex flex-col gap-2">
                  <Label className="flex items-center gap-1 text-base font-semibold">
                    التحويل إلى
                    <span className="text-destructive">*</span>
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {wallets.filter((w) => w.id.toString() !== txWalletId).map((w) => (
                      <button key={w.id} type="button" onClick={() => setTxTargetWalletId(w.id.toString())}
                        className={cn("px-3 py-2 rounded-full text-sm border transition-all shadow-sm",
                          txTargetWalletId === w.id.toString() ? "border-primary bg-primary/10 text-primary font-medium" : "border-border/50 hover:bg-muted/50"
                        )}>
                        {w.name}
                      </button>
                    ))}
                  </div>
                  {txTargetWalletId && (
                    <p className="text-xs text-emerald-600">✓ تم اختيار المحفظة المستقبلة</p>
                  )}
                </div>
              )}
            </form>
            </div>

            <DrawerFooter className="shrink-0 border-t border-border/50 bg-background/95 pt-4 pb-5 backdrop-blur">
              <Button onClick={handleAddTransaction} className="w-full h-14 rounded-2xl text-base shadow-lg shadow-primary/20" disabled={isSubmittingTransaction}>
                {isSubmittingTransaction ? (
                  <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /><span>جاري الحفظ...</span></div>
                ) : "حفظ المعاملة"}
              </Button>
              <DrawerClose asChild>
                <Button variant="outline" className="w-full h-14 rounded-2xl" disabled={isSubmittingTransaction}>إلغاء</Button>
              </DrawerClose>
            </DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
