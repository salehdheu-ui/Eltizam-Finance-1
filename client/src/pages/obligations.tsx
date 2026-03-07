import { Plus, Loader2, Trash2, Edit2, Power, PowerOff, Calendar, Wallet, AlertCircle, Receipt, Repeat, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { useObligations, useDeleteObligation, useToggleObligation, useCreateObligation, useUpdateObligation, useWallets, useCategories } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import type { Obligation } from "@shared/schema";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

// نموذج إضافة/تعديل الالتزام
interface ObligationFormProps {
  isOpen: boolean;
  onClose: () => void;
  editingObligation?: Obligation | null;
}

function ObligationForm({ isOpen, onClose, editingObligation }: ObligationFormProps) {
  const { data: wallets } = useWallets();
  const { data: categories } = useCategories();
  const createObligation = useCreateObligation();
  const updateObligation = useUpdateObligation();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    title: "",
    amount: "",
    obligationType: "custom",
    frequency: "monthly",
    dueDay: "",
    dueMonth: "",
    dueDate: "",
    walletId: "",
    categoryId: "",
    notes: "",
    isActive: true,
    autoCreateTransaction: false,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (editingObligation) {
      setFormData({
        title: editingObligation.title,
        amount: editingObligation.amount.toString(),
        obligationType: editingObligation.obligationType,
        frequency: editingObligation.frequency,
        dueDay: editingObligation.dueDay?.toString() || "",
        dueMonth: editingObligation.dueMonth?.toString() || "",
        dueDate: editingObligation.dueDate ? new Date(editingObligation.dueDate * 1000).toISOString().split('T')[0] : "",
        walletId: editingObligation.walletId?.toString() || "",
        categoryId: editingObligation.categoryId?.toString() || "",
        notes: editingObligation.notes || "",
        isActive: editingObligation.isActive,
        autoCreateTransaction: editingObligation.autoCreateTransaction,
      });
    } else {
      setFormData({
        title: "",
        amount: "",
        obligationType: "custom",
        frequency: "monthly",
        dueDay: "",
        dueMonth: "",
        dueDate: "",
        walletId: "",
        categoryId: "",
        notes: "",
        isActive: true,
        autoCreateTransaction: false,
      });
    }
    setErrors({});
  }, [editingObligation, isOpen]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.title.trim()) newErrors.title = "يجب إدخال عنوان الالتزام";
    if (!formData.amount || parseFloat(formData.amount) <= 0) newErrors.amount = "المبلغ يجب أن يكون أكبر من صفر";
    
    if (formData.frequency === "monthly" && !formData.dueDay) {
      newErrors.dueDay = "يجب تحديد يوم الاستحقاق";
    }
    if (formData.frequency === "yearly") {
      if (!formData.dueDay) newErrors.dueDay = "يجب تحديد يوم الاستحقاق";
      if (!formData.dueMonth) newErrors.dueMonth = "يجب تحديد شهر الاستحقاق";
    }
    if (formData.frequency === "one_time" && !formData.dueDate) {
      newErrors.dueDate = "يجب تحديد تاريخ الاستحقاق";
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const data = {
      title: formData.title,
      amount: parseFloat(formData.amount),
      obligationType: formData.obligationType,
      frequency: formData.frequency,
      dueDay: formData.frequency === "monthly" || formData.frequency === "yearly" ? parseInt(formData.dueDay) : null,
      dueMonth: formData.frequency === "yearly" ? parseInt(formData.dueMonth) : null,
      dueDate: formData.frequency === "one_time" && formData.dueDate ? Math.floor(new Date(formData.dueDate).getTime() / 1000) : null,
      walletId: formData.walletId ? parseInt(formData.walletId) : null,
      categoryId: formData.categoryId ? parseInt(formData.categoryId) : null,
      notes: formData.notes || null,
      isActive: formData.isActive,
      autoCreateTransaction: formData.autoCreateTransaction,
    };

    try {
      if (editingObligation) {
        await updateObligation.mutateAsync({ id: editingObligation.id, ...data });
        toast({ title: "تم التحديث", description: "تم تحديث الالتزام بنجاح" });
      } else {
        await createObligation.mutateAsync(data);
        toast({ title: "تم الإضافة", description: "تم إضافة الالتزام بنجاح" });
      }
      onClose();
    } catch (error: any) {
      toast({ 
        title: "خطأ", 
        description: error?.message || "فشل حفظ الالتزام", 
        variant: "destructive" 
      });
    }
  };

  return (
    <Drawer open={isOpen} onOpenChange={onClose}>
      <DrawerContent dir="rtl">
        <div className="mx-auto w-full max-w-sm">
          <DrawerHeader className="text-center">
            <DrawerTitle className="text-center">{editingObligation ? "تعديل الالتزام" : "إضافة التزام جديد"}</DrawerTitle>
            <DrawerDescription className="text-center">
              {editingObligation ? "قم بتعديل بيانات الالتزام" : "أدخل بيانات الالتزام المالي الجديد"}
            </DrawerDescription>
          </DrawerHeader>

          <form onSubmit={handleSubmit} className="p-4 pb-0 flex flex-col gap-4 max-h-[60vh] overflow-y-auto">
            <div className="flex flex-col gap-2">
              <Label htmlFor="title" className="text-right">عنوان الالتزام <span className="text-destructive">*</span></Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="مثال: قسط السيارة، فاتورة الكهرباء"
                className={cn("text-right", errors.title && "border-destructive")}
                required
              />
              {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="amount" className="text-right">المبلغ (ر.ع) <span className="text-destructive">*</span></Label>
              <Input
                id="amount"
                type="number"
                step="0.001"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                placeholder="0.000"
                className={cn("text-right", errors.amount && "border-destructive")}
              />
              {errors.amount && <p className="text-xs text-destructive">{errors.amount}</p>}
            </div>

            <div className="flex flex-col gap-3">
              <Label className="text-right">نوع الالتزام</Label>
              <div className="grid grid-cols-5 gap-2">
                {[
                  { value: "bill", label: "فاتورة", icon: "📄" },
                  { value: "installment", label: "قسط", icon: "🏦" },
                  { value: "subscription", label: "اشتراك", icon: "🔄" },
                  { value: "association", label: "جمعية", icon: "👥" },
                  { value: "custom", label: "مخصص", icon: "📝" },
                ].map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, obligationType: type.value })}
                    className={cn(
                      "flex flex-col items-center gap-1 p-2 rounded-xl text-xs transition-all",
                      formData.obligationType === type.value
                        ? "bg-primary/10 border-2 border-primary"
                        : "bg-muted/50 border border-transparent hover:bg-muted"
                    )}
                  >
                    <span className="text-xl">{type.icon}</span>
                    <span>{type.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <Label className="text-right">تكرار الدفع</Label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "monthly", label: "شهري" },
                  { value: "yearly", label: "سنوي" },
                  { value: "one_time", label: "مرة واحدة" },
                ].map((freq) => (
                  <button
                    key={freq.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, frequency: freq.value, dueDay: "", dueMonth: "", dueDate: "" })}
                    className={cn(
                      "px-3 py-2 rounded-xl text-sm transition-all",
                      formData.frequency === freq.value
                        ? "bg-primary/10 border-2 border-primary font-medium"
                        : "bg-muted/50 border border-transparent hover:bg-muted"
                    )}
                  >
                    {freq.label}
                  </button>
                ))}
              </div>
            </div>

            {formData.frequency === "monthly" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="dueDay" className="text-right">يوم الاستحقاق <span className="text-destructive">*</span></Label>
                <Input
                  id="dueDay"
                  type="number"
                  min="1"
                  max="31"
                  value={formData.dueDay}
                  onChange={(e) => setFormData({ ...formData, dueDay: e.target.value })}
                  placeholder="1-31"
                  className={cn("text-right", errors.dueDay && "border-destructive")}
                />
                {errors.dueDay && <p className="text-xs text-destructive">{errors.dueDay}</p>}
              </div>
            )}

            {formData.frequency === "yearly" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="dueDay" className="text-right">اليوم <span className="text-destructive">*</span></Label>
                  <Input
                    id="dueDay"
                    type="number"
                    min="1"
                    max="31"
                    value={formData.dueDay}
                    onChange={(e) => setFormData({ ...formData, dueDay: e.target.value })}
                    placeholder="1-31"
                    className={cn("text-right", errors.dueDay && "border-destructive")}
                  />
                  {errors.dueDay && <p className="text-xs text-destructive">{errors.dueDay}</p>}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="dueMonth" className="text-right">الشهر <span className="text-destructive">*</span></Label>
                  <select
                    id="dueMonth"
                    value={formData.dueMonth}
                    onChange={(e) => setFormData({ ...formData, dueMonth: e.target.value })}
                    className={cn(
                      "w-full h-10 px-3 rounded-md border bg-background text-sm",
                      errors.dueMonth && "border-destructive"
                    )}
                  >
                    <option value="">اختر الشهر</option>
                    {["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"].map((month, index) => (
                      <option key={index + 1} value={index + 1}>{month}</option>
                    ))}
                  </select>
                  {errors.dueMonth && <p className="text-xs text-destructive">{errors.dueMonth}</p>}
                </div>
              </div>
            )}

            {formData.frequency === "one_time" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="dueDate" className="text-right">تاريخ الاستحقاق <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <Calendar className="h-5 w-5 text-primary" />
                  </div>
                  <Input
                    id="dueDate"
                    type="date"
                    lang="ar"
                    value={formData.dueDate}
                    onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                    className={cn("text-right pr-11", errors.dueDate && "border-destructive")}
                  />
                </div>
                {errors.dueDate && <p className="text-xs text-destructive">{errors.dueDate}</p>}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="walletId" className="text-right">المحفظة المرتبطة</Label>
              <select
                id="walletId"
                value={formData.walletId}
                onChange={(e) => setFormData({ ...formData, walletId: e.target.value })}
                className="w-full h-10 px-3 rounded-md border bg-background text-sm"
              >
                <option value="">بدون محفظة</option>
                {wallets?.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="categoryId" className="text-right">القسم</Label>
              <select
                id="categoryId"
                value={formData.categoryId}
                onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                className="w-full h-10 px-3 rounded-md border bg-background text-sm"
              >
                <option value="">بدون قسم</option>
                {categories?.map((category) => (
                  <option key={category.id} value={category.id}>{category.icon} {category.name}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="notes" className="text-right">ملاحظات</Label>
              <Input
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="أي ملاحظات إضافية..."
                className="text-right"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="autoCreateTransaction"
                checked={formData.autoCreateTransaction}
                onChange={(e) => setFormData({ ...formData, autoCreateTransaction: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="autoCreateTransaction" className="text-sm cursor-pointer">
                إنشاء معاملة تلقائياً عند الاستحقاق
              </Label>
            </div>
          </form>

          <DrawerFooter>
            <Button 
              onClick={handleSubmit}
              className="w-full"
              disabled={createObligation.isPending || updateObligation.isPending}
            >
              {createObligation.isPending || updateObligation.isPending ? "جاري الحفظ..." : editingObligation ? "حفظ التغييرات" : "إضافة الالتزام"}
            </Button>
            <DrawerClose asChild>
              <Button type="button" variant="outline" className="w-full">إلغاء</Button>
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// Helper: حساب الالتزامات القادمة
function getUpcomingObligations(obligations: Obligation[] | undefined, limit: number = 3): Array<Obligation & { daysLeft: number }> {
  if (!obligations) return [];
  
  const now = new Date();
  const currentDay = now.getDate();
  const currentMonth = now.getMonth() + 1;
  
  const obligationsWithDaysLeft = obligations
    .filter(o => o.isActive)
    .map(o => {
      let daysLeft = 0;
      
      if (o.frequency === "monthly" && o.dueDay) {
        daysLeft = o.dueDay - currentDay;
        if (daysLeft < 0) daysLeft += 30;
      } else if (o.frequency === "yearly" && o.dueMonth && o.dueDay) {
        const monthsLeft = o.dueMonth - currentMonth;
        if (monthsLeft < 0) {
          daysLeft = (12 + monthsLeft) * 30 + (o.dueDay - currentDay);
        } else if (monthsLeft === 0) {
          daysLeft = o.dueDay - currentDay;
          if (daysLeft < 0) daysLeft += 365;
        } else {
          daysLeft = monthsLeft * 30 + (o.dueDay - currentDay);
        }
      } else if (o.frequency === "one_time" && o.dueDate) {
        const dueDate = new Date(o.dueDate * 1000);
        const diffTime = dueDate.getTime() - now.getTime();
        daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }
      
      return { ...o, daysLeft };
    })
    .filter((o): o is Obligation & { daysLeft: number } => o.daysLeft >= 0 && o.daysLeft <= 30)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, limit);
  
  return obligationsWithDaysLeft;
}

// Helper: تنسيق موعد الاستحقاق
function formatObligationDueDate(obligation: Obligation): string {
  if (obligation.frequency === "monthly" && obligation.dueDay) {
    return `يوم ${obligation.dueDay} من الشهر`;
  }
  if (obligation.frequency === "yearly" && obligation.dueMonth && obligation.dueDay) {
    const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    return `${obligation.dueDay} ${months[obligation.dueMonth - 1]}`;
  }
  if (obligation.frequency === "one_time" && obligation.dueDate) {
    return new Date(obligation.dueDate * 1000).toLocaleDateString("ar-OM", { day: "numeric", month: "long" });
  }
  return "غير محدد";
}
const obligationTypeIcons: Record<string, string> = {
  bill: "📄",
  installment: "🏦",
  subscription: "🔄",
  association: "👥",
  custom: "📝",
};

// أسماء أنواع الالتزامات بالعربية
const obligationTypeLabels: Record<string, string> = {
  bill: "فاتورة",
  installment: "قسط",
  subscription: "اشتراك",
  association: "جمعية",
  custom: "مخصص",
};

// أسماء التكرار بالعربية
const frequencyLabels: Record<string, string> = {
  monthly: "شهري",
  yearly: "سنوي",
  one_time: "مرة واحدة",
};

// ألوان حسب نوع الالتزام
const obligationTypeColors: Record<string, string> = {
  bill: "bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400",
  installment: "bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400",
  subscription: "bg-purple-100 text-purple-600 dark:bg-purple-950 dark:text-purple-400",
  association: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400",
  custom: "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400",
};

// تنسيق المبلغ
function formatAmount(amount: number) {
  return new Intl.NumberFormat("ar-OM", {
    style: "currency",
    currency: "OMR",
    minimumFractionDigits: 3,
  }).format(amount);
}

// عرض موعد الاستحقاق
function formatDueDate(obligation: Obligation) {
  if (obligation.frequency === "monthly" && obligation.dueDay) {
    return `${obligation.dueDay} من كل شهر`;
  }
  if (obligation.frequency === "yearly" && obligation.dueMonth && obligation.dueDay) {
    const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    return `${obligation.dueDay} ${months[obligation.dueMonth - 1]} من كل عام`;
  }
  if (obligation.frequency === "one_time" && obligation.dueDate) {
    return new Date(obligation.dueDate * 1000).toLocaleDateString("ar-OM", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  return "غير محدد";
}

export default function Obligations() {
  const { data: obligations, isLoading } = useObligations();
  const deleteObligation = useDeleteObligation();
  const toggleObligation = useToggleObligation();
  const { toast } = useToast();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingObligation, setEditingObligation] = useState<Obligation | null>(null);

  const handleDelete = async (id: number) => {
    try {
      await deleteObligation.mutateAsync(id);
      toast({ title: "تم الحذف", description: "تم حذف الالتزام بنجاح" });
    } catch {
      toast({ title: "خطأ", description: "فشل حذف الالتزام", variant: "destructive" });
    }
  };

  const handleToggle = async (id: number, isActive: boolean) => {
    try {
      await toggleObligation.mutateAsync(id);
      toast({
        title: isActive ? "تم الإيقاف" : "تم التفعيل",
        description: isActive ? "تم إيقاف الالتزام" : "تم تفعيل الالتزام",
      });
    } catch {
      toast({ title: "خطأ", description: "فشل تغيير حالة الالتزام", variant: "destructive" });
    }
  };

  const handleEdit = (obligation: Obligation) => {
    setEditingObligation(obligation);
    setIsFormOpen(true);
  };

  const handleAdd = () => {
    setEditingObligation(null);
    setIsFormOpen(true);
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setEditingObligation(null);
  };

  // حساب الإحصائيات
  const activeObligations = (obligations || []).filter((o) => o.isActive);
  const totalMonthlyAmount = activeObligations
    .filter((o) => o.frequency === "monthly")
    .reduce((sum, o) => sum + o.amount, 0);
  const upcomingObligations = getUpcomingObligations(obligations, 3);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-background animate-in fade-in duration-300">
        <header className="px-4 py-6 pb-4 bg-background sticky top-0 z-10 border-b border-border/50">
          <h1 className="text-2xl font-bold">الالتزامات</h1>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full animate-in fade-in duration-300">
      {/* Header */}
      <header className="px-4 py-6 pb-2">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">الالتزامات</h1>
          <Button 
            size="icon" 
            className="rounded-full shadow-md bg-primary text-primary-foreground cursor-pointer"
            onClick={() => handleAdd()}
          >
            <Plus className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* محتوى الصفحة */}
      <div className="flex-1 px-4 pb-24 overflow-auto">
        {obligations?.length === 0 ? (
          // حالة الصفحة الفارغة
          <div className="text-center py-16">
            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Receipt className="h-10 w-10 text-primary" />
            </div>
            <h3 className="font-bold text-xl mb-2">لا توجد التزامات</h3>
            <p className="text-muted-foreground mb-6 max-w-xs mx-auto">
              أضف التزاماتك المالية لتتبع مواعيد الاستحقاق والمبالغ
            </p>
            <Button 
              className="rounded-full px-6"
              onClick={() => handleAdd()}
            >
              <Plus className="h-5 w-5 ml-2" />
              إضافة أول التزام
            </Button>
          </div>
        ) : (
          // لوحة التحكم
          <div className="flex flex-col gap-6">
            {/* بطاقات الإحصائيات */}
            <div className="grid grid-cols-2 gap-3">
              <Card className="border-0 shadow-sm bg-emerald-50/50 dark:bg-emerald-950/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center">
                      <Power className="h-4 w-4 text-emerald-600" />
                    </div>
                    <span className="text-sm text-muted-foreground">النشطة</span>
                  </div>
                  <div className="text-2xl font-bold">{activeObligations.length}</div>
                </CardContent>
              </Card>
              
              <Card className="border-0 shadow-sm bg-destructive/5">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center">
                      <Wallet className="h-4 w-4 text-destructive" />
                    </div>
                    <span className="text-sm text-muted-foreground">شهرياً</span>
                  </div>
                  <div className="text-2xl font-bold text-destructive">
                    {formatAmount(totalMonthlyAmount)}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* الالتزامات القادمة */}
            {upcomingObligations.length > 0 && (
              <div>
                <h2 className="font-bold text-lg mb-3 flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-amber-500" />
                  الالتزامات القادمة
                </h2>
                <div className="flex flex-col gap-2">
                  {upcomingObligations.map((obligation) => (
                    <Card 
                      key={obligation.id} 
                      className="border-amber-200/50 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-950/10"
                    >
                      <CardContent className="p-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{obligationTypeIcons[obligation.obligationType]}</span>
                          <div>
                            <h4 className="font-semibold text-sm">{obligation.title}</h4>
                            <span className="text-xs text-muted-foreground">
                              {formatObligationDueDate(obligation)}
                            </span>
                          </div>
                        </div>
                        <div className="text-left">
                          <span className="font-bold text-destructive text-sm">
                            {formatAmount(obligation.amount)}
                          </span>
                          <div className="text-xs text-amber-600">
                            {obligation.daysLeft === 0 ? "اليوم" : 
                             obligation.daysLeft === 1 ? "غداً" : 
                             `بعد ${obligation.daysLeft} يوم`}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* قائمة جميع الالتزامات */}
            <div>
              <h2 className="font-bold text-lg mb-3">جميع الالتزامات</h2>
              <div className="flex flex-col gap-3">
                {obligations?.map((obligation) => (
                  <div 
                    key={obligation.id} 
                    className={cn(
                      "bg-card p-4 rounded-2xl border border-border/50 shadow-sm transition-all",
                      obligation.isActive ? "opacity-100" : "opacity-50 grayscale"
                    )}
                  >
                    {/* الصف الأول: المعلومات الأساسية */}
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className={cn(
                          "h-12 w-12 rounded-2xl flex items-center justify-center text-2xl shrink-0",
                          obligationTypeColors[obligation.obligationType]
                        )}>
                          {obligationTypeIcons[obligation.obligationType]}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-base truncate">{obligation.title}</h4>
                          <span className="text-xs text-muted-foreground">
                            {obligationTypeLabels[obligation.obligationType]}
                          </span>
                        </div>
                      </div>
                      <div className="text-left shrink-0">
                        <span className="text-lg font-bold text-destructive">
                          {formatAmount(obligation.amount)}
                        </span>
                      </div>
                    </div>

                    {/* الصف الثاني: التفاصيل والأزرار */}
                    <div className="flex items-center justify-between pt-3 border-t border-border/50">
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {formatDueDate(obligation)}
                        </span>
                        <span className="text-border">|</span>
                        <span>{frequencyLabels[obligation.frequency]}</span>
                        {obligation.isActive ? (
                          <span className="text-emerald-600 font-medium">• نشط</span>
                        ) : (
                          <span className="text-slate-400">• متوقف</span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <Button 
                          variant="ghost" 
                          size="icon"
                          className="h-8 w-8 rounded-full"
                          onClick={() => handleToggle(obligation.id, obligation.isActive)}
                          disabled={toggleObligation.isPending}
                          title={obligation.isActive ? "إيقاف" : "تفعيل"}
                        >
                          {obligation.isActive ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon"
                          className="h-8 w-8 rounded-full text-blue-600"
                          onClick={() => handleEdit(obligation)}
                          title="تعديل"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon"
                          className="h-8 w-8 rounded-full text-destructive"
                          onClick={() => handleDelete(obligation.id)}
                          disabled={deleteObligation.isPending}
                          title="حذف"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <ObligationForm 
        isOpen={isFormOpen} 
        onClose={handleCloseForm} 
        editingObligation={editingObligation}
      />
    </div>
  );
}
