import { CreditCard, Landmark, Wallet as WalletIcon, Plus, MoreHorizontal, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
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
import { useWallets, useCreateWallet, useUpdateWallet, useDeleteWallet } from "@/lib/hooks";
import type { Wallet } from "@shared/schema";

const walletColors = [
  { id: "slate", value: "from-slate-600 to-slate-800", bg: "bg-slate-700" },
  { id: "blue", value: "from-blue-600 to-blue-800", bg: "bg-blue-700" },
  { id: "emerald", value: "from-emerald-500 to-emerald-700", bg: "bg-emerald-600" },
  { id: "purple", value: "from-purple-600 to-indigo-800", bg: "bg-purple-700" },
  { id: "orange", value: "from-orange-400 to-red-500", bg: "bg-orange-500" },
  { id: "rose", value: "from-rose-500 to-rose-700", bg: "bg-rose-600" },
  { id: "cyan", value: "from-cyan-500 to-teal-700", bg: "bg-cyan-600" },
];

export default function Wallets() {
  const { toast } = useToast();
  const { data: wallets = [], isLoading } = useWallets();
  const createWallet = useCreateWallet();
  const updateWallet = useUpdateWallet();
  const deleteWallet = useDeleteWallet();
  
  const [isAddDrawerOpen, setIsAddDrawerOpen] = useState(false);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(null);
  const [newWalletName, setNewWalletName] = useState("");
  const [newWalletBalance, setNewWalletBalance] = useState("");
  const [selectedColor, setSelectedColor] = useState("from-slate-600 to-slate-800");
  const isSaving = createWallet.isPending || updateWallet.isPending;

  const handleAddWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWalletName || createWallet.isPending) return;
    try {
      await createWallet.mutateAsync({ name: newWalletName, balance: parseFloat(newWalletBalance) || 0, color: selectedColor, type: "cash" });
      setIsAddDrawerOpen(false);
      setNewWalletName("");
      setNewWalletBalance("");
      setSelectedColor("from-slate-600 to-slate-800");
      toast({ title: "تمت الإضافة", description: `تمت إضافة محفظة "${newWalletName}" بنجاح` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "فشل إضافة المحفظة";
      toast({ title: "خطأ", description: message, variant: "destructive" });
    }
  };

  const handleEditWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWallet || updateWallet.isPending) return;
    try {
      await updateWallet.mutateAsync({ id: selectedWallet.id, name: newWalletName, balance: parseFloat(newWalletBalance) || 0 });
      setIsEditDrawerOpen(false);
      toast({ title: "تم التعديل", description: "تم تحديث بيانات المحفظة بنجاح" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "فشل تعديل المحفظة";
      toast({ title: "خطأ", description: message, variant: "destructive" });
    }
  };
  
  const handleDeleteWallet = async () => {
    if (!selectedWallet || deleteWallet.isPending) return;
    if (!window.confirm(`هل تريد حذف المحفظة "${selectedWallet.name}"؟`)) {
      return;
    }
    try {
      await deleteWallet.mutateAsync(selectedWallet.id);
      setIsEditDrawerOpen(false);
      toast({ title: "تم الحذف", description: "تم حذف المحفظة بنجاح", variant: "destructive" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "فشل حذف المحفظة";
      toast({ title: "خطأ", description: message, variant: "destructive" });
    }
  };

  const openEditDrawer = (wallet: Wallet) => {
    setSelectedWallet(wallet);
    setNewWalletName(wallet.name);
    setNewWalletBalance(wallet.balance.toString());
    setIsEditDrawerOpen(true);
  };

  return (
    <div className="animate-in fade-in duration-300" dir="rtl">
      <header className="px-4 py-6 pb-2 sm:px-6 xl:px-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">المحافظ والحسابات</h1>
          <Button 
            size="icon" 
            variant="ghost" 
            className="rounded-full bg-primary/10 text-primary hover:bg-primary/20 border-none cursor-pointer"
            onClick={() => setIsAddDrawerOpen(true)}
            data-testid="button-add-wallet"
          >
            <Plus className="h-5 w-5" />
          </Button>
        </div>
        
        <div className="bg-card rounded-2xl p-4 border border-border shadow-sm flex justify-between items-center mb-4 hover-elevate transition-all">
          <div>
            <p className="text-sm text-muted-foreground mb-1">إجمالي الأرصدة</p>
            <p className="text-2xl font-bold" data-testid="text-total-wallets">
              <CurrencyDisplay amount={wallets.reduce((acc, w) => acc + w.balance, 0)} fractionDigits={2} symbolClassName="text-sm text-muted-foreground font-normal" />
            </p>
          </div>
          <div className="h-12 w-12 bg-primary/10 text-primary rounded-full flex items-center justify-center">
            <WalletIcon className="h-6 w-6" />
          </div>
        </div>
      </header>

      <div className="p-4 pb-24 sm:p-6 xl:p-8">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {wallets.map((wallet) => (
              <div 
                key={wallet.id} 
                className={cn(
                  "relative overflow-hidden rounded-2xl p-5 text-white shadow-md active-elevate transition-transform cursor-pointer",
                  "bg-gradient-to-br", wallet.color
                )}
                onClick={() => openEditDrawer(wallet)}
                data-testid={`card-wallet-${wallet.id}`}
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-10 -mt-10"></div>
                <div className="absolute bottom-0 left-0 w-24 h-24 bg-black/10 rounded-full blur-2xl -ml-5 -mb-5"></div>
                
                <div className="relative z-10 flex justify-between items-start mb-8">
                  <div className="flex items-center gap-3">
                    <div className="bg-white/20 p-2.5 rounded-xl backdrop-blur-sm">
                      <WalletIcon className="h-5 w-5" />
                    </div>
                    <h3 className="font-bold text-lg text-white/90">{wallet.name}</h3>
                  </div>
                  <Button 
                    size="icon" 
                    variant="ghost" 
                    className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/20 rounded-full -mr-2"
                    onClick={(e) => { e.stopPropagation(); openEditDrawer(wallet); }}
                  >
                    <MoreHorizontal className="h-5 w-5" />
                  </Button>
                </div>
                
                <div className="relative z-10">
                  <p className="text-white/70 text-xs mb-1">الرصيد الحالي</p>
                  <p className="text-3xl font-black tracking-tight flex items-baseline gap-1">
                    <CurrencyDisplay amount={wallet.balance} fractionDigits={2} symbolClassName="text-lg font-medium opacity-80" />
                  </p>
                </div>
              </div>
            ))}
            
            {wallets.length === 0 && (
              <div className="text-center py-10 bg-muted/20 rounded-2xl border border-dashed border-border/50">
                <WalletIcon className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground font-medium">لا توجد محافظ</p>
                <Button variant="link" className="mt-2" onClick={() => setIsAddDrawerOpen(true)}>أضف محفظة الآن</Button>
              </div>
            )}
          </div>
        )}
      </div>

      <Drawer open={isAddDrawerOpen} onOpenChange={setIsAddDrawerOpen}>
        <DrawerContent dir="rtl">
          <div className="mx-auto w-full max-w-lg">
            <DrawerHeader>
              <DrawerTitle>إضافة محفظة جديدة</DrawerTitle>
              <DrawerDescription>أدخل تفاصيل المحفظة أو الحساب البنكي الجديد.</DrawerDescription>
            </DrawerHeader>
            <form onSubmit={handleAddWallet} className="p-4 pb-0 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="wallet-name" className="text-right">اسم المحفظة</Label>
                <Input id="wallet-name" placeholder="مثال: حساب التوفير" value={newWalletName} onChange={(e) => setNewWalletName(e.target.value)} className="text-right" required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="wallet-balance" className="text-right">الرصيد الافتتاحي</Label>
                <Input id="wallet-balance" type="number" placeholder="0.00" value={newWalletBalance} onChange={(e) => setNewWalletBalance(e.target.value)} className="text-right" />
              </div>
              <div className="flex flex-col gap-3 mt-2">
                <Label className="text-right">لون المحفظة</Label>
                <div className="flex gap-3 flex-wrap justify-end">
                  {walletColors.map((color) => (
                    <button key={color.id} type="button" onClick={() => setSelectedColor(color.value)}
                      className={cn("w-10 h-10 rounded-full transition-all flex items-center justify-center cursor-pointer border-2", color.bg,
                        selectedColor === color.value ? "ring-2 ring-primary ring-offset-2 ring-offset-background border-white scale-110" : "border-transparent hover:scale-105 opacity-80"
                      )} />
                  ))}
                </div>
              </div>
            </form>
            <DrawerFooter>
              <Button type="submit" onClick={handleAddWallet} className="w-full" disabled={createWallet.isPending}>
                {createWallet.isPending ? "جاري الإضافة..." : "إضافة"}
              </Button>
              <DrawerClose asChild><Button variant="outline" className="w-full" disabled={createWallet.isPending}>إلغاء</Button></DrawerClose>
            </DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer open={isEditDrawerOpen} onOpenChange={setIsEditDrawerOpen}>
        <DrawerContent dir="rtl">
          <div className="mx-auto w-full max-w-lg">
            <DrawerHeader>
              <DrawerTitle>تعديل المحفظة</DrawerTitle>
              <DrawerDescription>تحديث بيانات المحفظة أو حذفها.</DrawerDescription>
            </DrawerHeader>
            <form onSubmit={handleEditWallet} className="p-4 pb-0 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="edit-wallet-name" className="text-right">اسم المحفظة</Label>
                <Input id="edit-wallet-name" value={newWalletName} onChange={(e) => setNewWalletName(e.target.value)} className="text-right" required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="edit-wallet-balance" className="text-right">الرصيد الحالي</Label>
                <Input id="edit-wallet-balance" type="number" value={newWalletBalance} onChange={(e) => setNewWalletBalance(e.target.value)} className="text-right" />
              </div>
            </form>
            <DrawerFooter className="flex-row gap-2 px-4 pb-8 pt-4">
              <Button type="submit" onClick={handleEditWallet} className="flex-1" disabled={isSaving}>
                {updateWallet.isPending ? "جاري الحفظ..." : "حفظ التعديلات"}
              </Button>
              <Button variant="destructive" size="icon" onClick={handleDeleteWallet} disabled={deleteWallet.isPending || updateWallet.isPending}>
                <Trash2 className="h-5 w-5" />
              </Button>
            </DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
