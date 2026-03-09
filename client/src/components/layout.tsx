import { Link, useLocation } from "wouter";
import { Home, ListFilter, Wallet, PieChart, Plus, Settings, Loader2, BarChart3, Menu, X, ChevronLeft, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { useCategories, useWallets, useCreateTransaction } from "@/lib/hooks";

interface LayoutProps {
  children: React.ReactNode;
}

type AddTransactionDetail = {
  type?: string;
  amount?: string;
  note?: string;
  categoryId?: string;
  walletId?: string;
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

  const { data: categoriesData } = useCategories();
  const { data: walletsData } = useWallets();
  const createTransaction = useCreateTransaction();

  const categories = categoriesData || [];
  const wallets = walletsData || [];
  const filteredCategories = categories.filter(c => c.type === txType);

  useEffect(() => {
    const handleOpenAddTransaction = (event: Event) => {
      const customEvent = event as CustomEvent<AddTransactionDetail | undefined>;
      const detail = customEvent.detail;

      if (detail) {
        if (detail.type) setTxType(detail.type);
        if (detail.amount !== undefined) setTxAmount(detail.amount);
        if (detail.note !== undefined) setTxNote(detail.note);
        if (detail.categoryId !== undefined) setTxCategoryId(detail.categoryId);
        if (detail.walletId !== undefined) setTxWalletId(detail.walletId);
      }

      setIsAddTxOpen(true);
    };

    window.addEventListener('open-add-transaction', handleOpenAddTransaction as EventListener);
    return () => window.removeEventListener('open-add-transaction', handleOpenAddTransaction);
  }, []);

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
      await createTransaction.mutateAsync({
        type: txType,
        amount: parseFloat(txAmount),
        note: txNote || "",
        categoryId: txCategoryId ? parseInt(txCategoryId) : null,
        walletId: parseInt(txWalletId),
      });
      
      toast({
        title: "تمت الإضافة بنجاح",
        description: `تم تسجيل ${txType === 'expense' ? 'مصروف' : txType === 'income' ? 'دخل' : 'دين'} بقيمة ${txAmount} ر.ع`,
      });
      
      setIsAddTxOpen(false);
      setTxAmount("");
      setTxNote("");
      setTxCategoryId("");
      setTxWalletId("");
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
          <div className="mx-auto w-full max-w-sm">
            <DrawerHeader>
              <DrawerTitle>إضافة معاملة جديدة</DrawerTitle>
              <DrawerDescription>سجل تفاصيل الدخل، المصروف، أو الدين.</DrawerDescription>
            </DrawerHeader>
            
            <form onSubmit={handleAddTransaction} className="p-4 pb-0 flex flex-col gap-5">
              <div className="flex bg-muted/50 p-1 rounded-xl">
                {["expense", "income", "debt"].map((type) => (
                  <button key={type} type="button" onClick={() => { setTxType(type); setTxCategoryId(""); }}
                    className={cn("flex-1 py-2 text-sm rounded-lg transition-all",
                      txType === type ? "bg-background shadow-sm font-medium text-foreground" : "text-muted-foreground"
                    )}>
                    {type === 'expense' ? 'مصروف' : type === 'income' ? 'دخل' : 'دين'}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="tx-amount">المبلغ (ر.ع)</Label>
                <Input id="tx-amount" type="number" placeholder="0.00" value={txAmount} onChange={(e) => setTxAmount(e.target.value)} className="text-right text-lg" required step="0.01" />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="tx-note">ملاحظة</Label>
                <Input id="tx-note" placeholder="مثال: عشاء، راتب شهري..." value={txNote} onChange={(e) => setTxNote(e.target.value)} className="text-right" />
              </div>

              {filteredCategories.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Label>القسم</Label>
                  <div className="flex flex-wrap gap-2">
                    {filteredCategories.map((cat) => (
                      <button key={cat.id} type="button" onClick={() => setTxCategoryId(cat.id.toString())}
                        className={cn("px-3 py-1.5 rounded-full text-sm border transition-all flex items-center gap-1.5",
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
                <Label className="flex items-center gap-1">
                  المحفظة
                  <span className="text-destructive">*</span>
                </Label>
                {wallets.length === 0 ? (
                  <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-sm text-center">
                    لا توجد محافظ. يجب إنشاء محفظة أولاً من صفحة المحافظ
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {wallets.map((w) => (
                      <button key={w.id} type="button" onClick={() => setTxWalletId(w.id.toString())}
                        className={cn("px-3 py-1.5 rounded-full text-sm border transition-all",
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

            <DrawerFooter className="pt-6">
              <Button onClick={handleAddTransaction} className="w-full" disabled={createTransaction.isPending}>
                {createTransaction.isPending ? (
                  <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /><span>جاري الحفظ...</span></div>
                ) : "حفظ المعاملة"}
              </Button>
              <DrawerClose asChild>
                <Button variant="outline" className="w-full">إلغاء</Button>
              </DrawerClose>
            </DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
