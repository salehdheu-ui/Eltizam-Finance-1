import { Landmark, Plus, Loader2, Trash2, Repeat, Wallet, ArrowDownCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn, formatCurrency, formatMonthKeyLabel } from "@/lib/utils";
import { useCategories, useCreateRecurringIncome, useCreateTransaction, useDeleteRecurringIncome, useRecurringIncomes, useUpdateRecurringIncome, useWallets } from "@/lib/hooks";
import type { RecurringIncome } from "@shared/schema";

export default function Income() {
  const { toast } = useToast();
  const { data: recurringIncomes = [], isLoading } = useRecurringIncomes();
  const { data: wallets = [] } = useWallets();
  const { data: categories = [] } = useCategories();
  const createRecurringIncome = useCreateRecurringIncome();
  const updateRecurringIncome = useUpdateRecurringIncome();
  const deleteRecurringIncome = useDeleteRecurringIncome();
  const createTransaction = useCreateTransaction();

  const [isSalaryDrawerOpen, setIsSalaryDrawerOpen] = useState(false);
  const [salaryTitle, setSalaryTitle] = useState("");
  const [salaryAmount, setSalaryAmount] = useState("");
  const [salaryDay, setSalaryDay] = useState("1");
  const [salaryWalletId, setSalaryWalletId] = useState("");
  const [salaryCategoryId, setSalaryCategoryId] = useState("");
  const [salaryNote, setSalaryNote] = useState("");

  const [manualAmount, setManualAmount] = useState("");
  const [manualWalletId, setManualWalletId] = useState("");
  const [manualCategoryId, setManualCategoryId] = useState("");
  const [manualNote, setManualNote] = useState("");

  const salaryDayOptions = Array.from({ length: 31 }, (_, index) => String(index + 1));

  const incomeCategories = useMemo(() => categories.filter((category) => category.type === "income"), [categories]);
  const activeRecurringTotal = recurringIncomes.filter((item) => item.isActive).reduce((sum, item) => sum + item.amount, 0);

  const resetSalaryForm = () => {
    setSalaryTitle("");
    setSalaryAmount("");
    setSalaryDay("1");
    setSalaryWalletId("");
    setSalaryCategoryId("");
    setSalaryNote("");
  };

  const handleCreateSalary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!salaryTitle || !salaryAmount || !salaryWalletId) {
      toast({ title: "خطأ", description: "أكمل بيانات الراتب المطلوبة", variant: "destructive" });
      return;
    }

    try {
      await createRecurringIncome.mutateAsync({
        title: salaryTitle,
        amount: parseFloat(salaryAmount),
        incomeType: "salary",
        dayOfMonth: parseInt(salaryDay, 10),
        walletId: parseInt(salaryWalletId, 10),
        categoryId: salaryCategoryId ? parseInt(salaryCategoryId, 10) : null,
        note: salaryNote || null,
        isActive: true,
        lastAppliedMonth: null,
      });
      setIsSalaryDrawerOpen(false);
      resetSalaryForm();
      toast({ title: "تمت الإضافة", description: "تم حفظ الراتب الشهري بنجاح" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "فشل حفظ الراتب";
      toast({ title: "خطأ", description: message, variant: "destructive" });
    }
  };

  const handleManualIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualAmount || !manualWalletId) {
      toast({ title: "خطأ", description: "أدخل مبلغ الدخل واختر المحفظة", variant: "destructive" });
      return;
    }

    try {
      await createTransaction.mutateAsync({
        type: "income",
        amount: parseFloat(manualAmount),
        walletId: parseInt(manualWalletId, 10),
        categoryId: manualCategoryId ? parseInt(manualCategoryId, 10) : null,
        note: manualNote || "دخل إضافي",
      });
      setManualAmount("");
      setManualWalletId("");
      setManualCategoryId("");
      setManualNote("");
      toast({ title: "تمت الإضافة", description: "تم تسجيل الدخل الإضافي بنجاح" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "فشل تسجيل الدخل";
      toast({ title: "خطأ", description: message, variant: "destructive" });
    }
  };

  const handleToggleRecurringIncome = async (income: RecurringIncome) => {
    try {
      await updateRecurringIncome.mutateAsync({ id: income.id, isActive: !income.isActive });
      toast({
        title: income.isActive ? "تم الإيقاف" : "تم التفعيل",
        description: income.isActive ? "تم إيقاف الدخل المتكرر" : "تم تفعيل الدخل المتكرر",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "فشل تحديث الحالة";
      toast({ title: "خطأ", description: message, variant: "destructive" });
    }
  };

  const handleDeleteRecurringIncome = async (income: RecurringIncome) => {
    if (!window.confirm(`هل تريد حذف \"${income.title}\"؟`)) {
      return;
    }

    try {
      await deleteRecurringIncome.mutateAsync(income.id);
      toast({ title: "تم الحذف", description: "تم حذف الدخل المتكرر" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "فشل حذف الدخل المتكرر";
      toast({ title: "خطأ", description: message, variant: "destructive" });
    }
  };

  return (
    <div className="animate-in fade-in duration-300">
      <header className="px-4 py-6 pb-2">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">الدخل والراتب</h1>
            <p className="text-sm text-muted-foreground mt-1">أدر الرواتب الشهرية وسجّل أي دخل إضافي يدويًا</p>
          </div>
          <Button size="icon" className="rounded-full shadow-md" onClick={() => setIsSalaryDrawerOpen(true)}>
            <Plus className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <div className="px-4 pb-24 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Card className="border-emerald-200 bg-emerald-50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="h-10 w-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <Repeat className="h-5 w-5" />
                </div>
                <span className="text-xs font-bold text-emerald-700">{recurringIncomes.filter((item) => item.isActive).length} نشط</span>
              </div>
              <p className="text-xs text-emerald-700 font-medium">إجمالي الدخل الشهري الثابت</p>
              <p className="text-xl font-bold text-emerald-800"><CurrencyDisplay amount={activeRecurringTotal} fractionDigits={2} /></p>
            </CardContent>
          </Card>
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="h-10 w-10 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center">
                  <Landmark className="h-5 w-5" />
                </div>
                <span className="text-xs font-bold text-blue-700">{recurringIncomes.length} إجمالي</span>
              </div>
              <p className="text-xs text-blue-700 font-medium">مصادر الدخل المتكرر</p>
              <p className="text-xl font-bold text-blue-800">{recurringIncomes.filter((item) => item.incomeType === "salary").length} راتب</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <ArrowDownCircle className="h-5 w-5 text-primary" />
              دخل إضافي يدوي
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleManualIncome} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>المبلغ</Label>
                  <Input type="number" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} placeholder="0.000" />
                </div>
                <div className="space-y-2">
                  <Label>المحفظة</Label>
                  <select value={manualWalletId} onChange={(e) => setManualWalletId(e.target.value)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none w-full">
                    <option value="">اختر المحفظة</option>
                    {wallets.map((wallet) => (
                      <option key={wallet.id} value={wallet.id.toString()}>{wallet.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>القسم</Label>
                  <select value={manualCategoryId} onChange={(e) => setManualCategoryId(e.target.value)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none w-full">
                    <option value="">بدون قسم</option>
                    {incomeCategories.map((category) => (
                      <option key={category.id} value={category.id.toString()}>{category.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>الملاحظة</Label>
                  <Input value={manualNote} onChange={(e) => setManualNote(e.target.value)} placeholder="مثال: مكافأة أو عمل إضافي" />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={createTransaction.isPending}>
                {createTransaction.isPending ? "جاري التسجيل..." : "تسجيل دخل إضافي"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Landmark className="h-5 w-5 text-primary" />
              الرواتب والدخل المتكرر
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : recurringIncomes.length > 0 ? (
              recurringIncomes.map((income) => {
                const walletName = wallets.find((wallet) => wallet.id === income.walletId)?.name || "محفظة غير معروفة";
                return (
                  <div key={income.id} className="rounded-2xl border border-border/60 p-4 bg-card shadow-sm space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold">{income.title}</h3>
                          <span className={cn("text-[11px] px-2 py-1 rounded-full font-medium", income.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")}>{income.isActive ? "نشط" : "متوقف"}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">يُسجل يوم {income.dayOfMonth} من كل شهر</p>
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-emerald-600"><CurrencyDisplay amount={income.amount} fractionDigits={2} /></p>
                        <p className="text-xs text-muted-foreground mt-1">{income.incomeType === "salary" ? "راتب" : "دخل متكرر"}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Wallet className="h-3 w-3" />{walletName}</span>
                      <span>آخر تطبيق: {formatMonthKeyLabel(income.lastAppliedMonth)}</span>
                    </div>
                    {income.note ? <p className="text-sm text-muted-foreground">{income.note}</p> : null}
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => handleToggleRecurringIncome(income)} disabled={updateRecurringIncome.isPending}>
                        {income.isActive ? "إيقاف" : "تفعيل"}
                      </Button>
                      <Button variant="destructive" size="icon" onClick={() => handleDeleteRecurringIncome(income)} disabled={deleteRecurringIncome.isPending || updateRecurringIncome.isPending}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-10 bg-muted/20 rounded-2xl border border-dashed border-border/50">
                <Landmark className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
                <p className="font-medium">لا توجد رواتب أو دخول متكررة بعد</p>
                <p className="text-xs text-muted-foreground mt-1">أضف راتبك الشهري ليقوم النظام بتسجيله تلقائيًا</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Drawer open={isSalaryDrawerOpen} onOpenChange={setIsSalaryDrawerOpen}>
        <DrawerContent dir="rtl">
          <div className="mx-auto w-full max-w-sm">
            <DrawerHeader>
              <DrawerTitle>إضافة راتب شهري</DrawerTitle>
              <DrawerDescription>سيتم تسجيل هذا الدخل تلقائيًا عند حلول يوم الإيداع الشهري</DrawerDescription>
            </DrawerHeader>
            <form onSubmit={handleCreateSalary} className="p-4 pb-0 flex flex-col gap-4">
              <div className="space-y-2">
                <Label>اسم الراتب</Label>
                <Input value={salaryTitle} onChange={(e) => setSalaryTitle(e.target.value)} placeholder="مثال: راتب الوظيفة" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>المبلغ</Label>
                  <Input type="number" value={salaryAmount} onChange={(e) => setSalaryAmount(e.target.value)} placeholder="0.000" required />
                </div>
                <div className="space-y-2">
                  <Label>يوم الإيداع</Label>
                  <select value={salaryDay} onChange={(e) => setSalaryDay(e.target.value)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none w-full" required>
                    {salaryDayOptions.map((day) => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>المحفظة</Label>
                <select value={salaryWalletId} onChange={(e) => setSalaryWalletId(e.target.value)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none w-full">
                  <option value="">اختر المحفظة</option>
                  {wallets.map((wallet) => (
                    <option key={wallet.id} value={wallet.id.toString()}>{wallet.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>قسم الدخل</Label>
                <select value={salaryCategoryId} onChange={(e) => setSalaryCategoryId(e.target.value)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none w-full">
                  <option value="">بدون قسم</option>
                  {incomeCategories.map((category) => (
                    <option key={category.id} value={category.id.toString()}>{category.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>ملاحظة</Label>
                <Textarea value={salaryNote} onChange={(e) => setSalaryNote(e.target.value)} placeholder="مثال: راتب ثابت من جهة العمل" className="min-h-24" />
              </div>
            </form>
            <DrawerFooter>
              <Button onClick={handleCreateSalary} className="w-full" disabled={createRecurringIncome.isPending}>
                {createRecurringIncome.isPending ? "جاري الحفظ..." : "حفظ الراتب"}
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setIsSalaryDrawerOpen(false)}>إلغاء</Button>
            </DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
