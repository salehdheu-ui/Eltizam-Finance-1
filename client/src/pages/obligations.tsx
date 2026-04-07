import { Plus, Loader2, Trash2, Edit2, Power, PowerOff, Calendar, Wallet, AlertCircle, Receipt, Repeat, X, Filter, ArrowLeftRight, Sparkles, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatCurrency, formatDate, formatObligationDueDate, getObligationStatusLabel, getUpcomingObligations, isObligationEnded, toDate } from "@/lib/utils";
import { useState, useEffect, useMemo, useRef } from "react";
import { useObligations, useDeleteObligation, useToggleObligation, useCreateObligation, useUpdateObligation, useWallets, useCategories, useVariableObligationStatuses } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import type { Obligation, VariableObligationMonthStatus } from "@shared/schema";
import { Link } from "wouter";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

function blurActiveElement() {
  if (typeof document === "undefined") {
    return;
  }

  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement) {
    activeElement.blur();
  }
}

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
    scheduleType: "fixed",
    obligationType: "custom",
    frequency: "monthly",
    dueDay: "",
    dueMonth: "",
    dueDate: "",
    startDate: new Date().toISOString().split('T')[0],
    endDate: "",
    walletId: "",
    categoryId: "",
    notes: "",
    isActive: true,
    autoCreateTransaction: false,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const startDateRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);
  const dueDateRef = useRef<HTMLInputElement>(null);
  const isSubmitting = createObligation.isPending || updateObligation.isPending;

  useEffect(() => {
    if (editingObligation) {
      setFormData({
        title: editingObligation.title,
        amount: editingObligation.amount.toString(),
        scheduleType: editingObligation.scheduleType,
        obligationType: editingObligation.obligationType,
        frequency: editingObligation.frequency,
        dueDay: editingObligation.dueDay?.toString() || "",
        dueMonth: editingObligation.dueMonth?.toString() || "",
        dueDate: editingObligation.dueDate ? new Date(editingObligation.dueDate * 1000).toISOString().split('T')[0] : "",
        startDate: editingObligation.startDate ? new Date(editingObligation.startDate * 1000).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        endDate: editingObligation.endDate ? new Date(editingObligation.endDate * 1000).toISOString().split('T')[0] : "",
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
        scheduleType: "fixed",
        obligationType: "custom",
        frequency: "monthly",
        dueDay: "",
        dueMonth: "",
        dueDate: "",
        startDate: new Date().toISOString().split('T')[0],
        endDate: "",
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
    if (!formData.startDate) newErrors.startDate = "يجب تحديد تاريخ البداية";
    if (formData.endDate && formData.startDate && new Date(formData.endDate) < new Date(formData.startDate)) {
      newErrors.endDate = "يجب أن يكون تاريخ الانتهاء بعد تاريخ البداية";
    }
    
    if (formData.scheduleType === "variable" && !formData.dueDate) {
      newErrors.dueDate = "يجب تحديد تاريخ دفع الالتزام";
    }
    if (formData.scheduleType === "fixed" && formData.frequency === "monthly" && !formData.dueDay) {
      newErrors.dueDay = "يجب تحديد يوم الدفع";
    }
    if (formData.scheduleType === "fixed" && formData.frequency === "yearly") {
      if (!formData.dueDay) newErrors.dueDay = "يجب تحديد يوم الدفع";
      if (!formData.dueMonth) newErrors.dueMonth = "يجب تحديد شهر الاستحقاق";
    }
    if (formData.scheduleType === "fixed" && formData.frequency === "one_time" && !formData.dueDate) {
      newErrors.dueDate = "يجب تحديد تاريخ دفع الالتزام";
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!validate()) return;

    const data = {
      title: formData.title,
      amount: parseFloat(formData.amount),
      scheduleType: formData.scheduleType,
      obligationType: formData.obligationType,
      frequency: formData.frequency,
      dueDay: formData.scheduleType === "fixed" && (formData.frequency === "monthly" || formData.frequency === "yearly") ? parseInt(formData.dueDay) : null,
      dueMonth: formData.scheduleType === "fixed" && formData.frequency === "yearly" ? parseInt(formData.dueMonth) : null,
      dueDate: formData.dueDate ? Math.floor(new Date(formData.dueDate).getTime() / 1000) : null,
      startDate: Math.floor(new Date(formData.startDate).getTime() / 1000),
      endDate: formData.endDate ? Math.floor(new Date(formData.endDate).getTime() / 1000) : null,
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "فشل حفظ الالتزام";
      toast({ 
        title: "خطأ", 
        description: message,
        variant: "destructive" 
      });
    }
  };

  const openDatePicker = (input: HTMLInputElement | null) => {
    if (!input) return;
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
      } catch {
        input.focus();
      }
      return;
    }
    input.focus();
    input.click();
  };

  const dateInputClassName = "absolute inset-0 opacity-0 cursor-pointer [color-scheme:light] [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full";

  const getDisplayedDateValue = (value: string) => {
    if (!value) return "";
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return formatDate(date, { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  return (
    <Drawer open={isOpen} onOpenChange={(open) => {
      if (!open) {
        blurActiveElement();
        onClose();
      }
    }}>
      <DrawerContent dir="rtl">
        <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
          <DrawerHeader className="shrink-0 px-4 pb-3 text-center sm:px-6">
            <DrawerTitle className="text-center text-xl">{editingObligation ? "تعديل الالتزام" : "إضافة التزام جديد"}</DrawerTitle>
            <DrawerDescription className="text-center text-sm leading-6">
              {editingObligation ? "قم بتعديل بيانات الالتزام" : "أدخل بيانات الالتزام المالي الجديد"}
            </DrawerDescription>
          </DrawerHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4 pb-2 sm:gap-5">
            <div className="app-field">
              <Label htmlFor="title" className="text-right">عنوان الالتزام <span className="text-destructive">*</span></Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="مثال: قسط السيارة، فاتورة الكهرباء"
                className={cn("app-input text-right", errors.title && "border-destructive")}
                required
              />
              {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
            </div>

            <div className="app-field">
              <Label htmlFor="amount" className="text-right">المبلغ (ر.ع) <span className="text-destructive">*</span></Label>
              <Input
                id="amount"
                type="number"
                step="0.001"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                placeholder="0.000"
                className={cn("app-input text-right", errors.amount && "border-destructive")}
              />
              {errors.amount && <p className="text-xs text-destructive">{errors.amount}</p>}
            </div>

            <div className="flex flex-col gap-3">
              <Label className="text-right">جدولة الالتزام</Label>
              <div className="grid grid-cols-2 gap-2">
                {[{ value: "fixed", label: "ثابت" }, { value: "variable", label: "متغير" }].map((schedule) => (
                  <button
                    key={schedule.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, scheduleType: schedule.value, frequency: schedule.value === "variable" ? "one_time" : formData.frequency, dueDay: "", dueMonth: "", dueDate: formData.scheduleType === schedule.value ? formData.dueDate : "", endDate: schedule.value === "fixed" ? "" : formData.endDate })}
                    className={cn(
                      "min-h-11 px-3 py-2 rounded-xl text-sm transition-all",
                      formData.scheduleType === schedule.value
                        ? "bg-primary/10 border-2 border-primary font-medium"
                        : "bg-muted/50 border border-transparent hover:bg-muted"
                    )}
                  >
                    {schedule.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={cn("grid gap-3", formData.scheduleType === "variable" ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1")}>
              <div className="app-field">
                <Label htmlFor="startDate" className="text-right">تاريخ البداية <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Input
                    value={getDisplayedDateValue(formData.startDate)}
                    readOnly
                    dir="ltr"
                    onClick={() => openDatePicker(startDateRef.current)}
                    className={cn("app-input text-left pl-12 pr-3 tracking-[0.02em] [font-variant-numeric:lining-nums] [font-family:Arial,Helvetica,sans-serif]", errors.startDate && "border-destructive")}
                  />
                  <Input
                    ref={startDateRef}
                    id="startDate"
                    type="date"
                    lang="en-GB"
                    dir="ltr"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    onClick={() => openDatePicker(startDateRef.current)}
                    onKeyDown={(e) => e.preventDefault()}
                    onPaste={(e) => e.preventDefault()}
                    className={cn(dateInputClassName, errors.startDate && "border-destructive")}
                  />
                  <button
                    type="button"
                    onClick={() => openDatePicker(startDateRef.current)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/15 transition-colors"
                    aria-label="اختيار تاريخ البداية"
                  >
                    <Calendar className="h-4 w-4" />
                  </button>
                </div>
                {errors.startDate && <p className="text-xs text-destructive">{errors.startDate}</p>}
              </div>
              {formData.scheduleType === "variable" && (
              <div className="app-field">
                <Label htmlFor="endDate" className="text-right">تاريخ الانتهاء</Label>
                <div className="relative">
                  <Input
                    value={getDisplayedDateValue(formData.endDate)}
                    readOnly
                    dir="ltr"
                    onClick={() => openDatePicker(endDateRef.current)}
                    className={cn("app-input text-left pl-12 pr-3 tracking-[0.02em] [font-variant-numeric:lining-nums] [font-family:Arial,Helvetica,sans-serif]", errors.endDate && "border-destructive")}
                  />
                  <Input
                    ref={endDateRef}
                    id="endDate"
                    type="date"
                    lang="en-GB"
                    dir="ltr"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    onClick={() => openDatePicker(endDateRef.current)}
                    onKeyDown={(e) => e.preventDefault()}
                    onPaste={(e) => e.preventDefault()}
                    className={cn(dateInputClassName, errors.endDate && "border-destructive")}
                  />
                  <button
                    type="button"
                    onClick={() => openDatePicker(endDateRef.current)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/15 transition-colors"
                    aria-label="اختيار تاريخ الانتهاء"
                  >
                    <Calendar className="h-4 w-4" />
                  </button>
                </div>
                {errors.endDate && <p className="text-xs text-destructive">{errors.endDate}</p>}
              </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <Label className="text-right">نوع الالتزام</Label>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {[{ value: "bill", label: "فاتورة", icon: "📄" }, { value: "installment", label: "قسط", icon: "🏦" }, { value: "subscription", label: "اشتراك", icon: "🔄" }, { value: "association", label: "جمعية", icon: "👥" }, { value: "custom", label: "مخصص", icon: "📝" }].map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, obligationType: type.value })}
                    className={cn(
                      "flex min-h-[84px] flex-col items-center justify-center gap-1 p-2 rounded-xl text-xs transition-all",
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

            {formData.scheduleType === "fixed" && (
              <div className="flex flex-col gap-3">
                <Label className="text-right">تكرار الدفع</Label>
                <div className="grid grid-cols-3 gap-2">
                  {[{ value: "monthly", label: "شهري" }, { value: "yearly", label: "سنوي" }, { value: "one_time", label: "مرة واحدة" }].map((freq) => (
                    <button
                      key={freq.value}
                      type="button"
                      onClick={() => setFormData({ ...formData, frequency: freq.value, dueDay: "", dueMonth: "", dueDate: "" })}
                      className={cn(
                        "min-h-11 px-3 py-2 rounded-xl text-sm transition-all",
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
            )}

            {(formData.scheduleType === "variable" || formData.frequency === "one_time") && (
              <div className="app-field">
                <Label htmlFor="dueDate" className="text-right">تاريخ دفع الالتزام <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Input
                    value={getDisplayedDateValue(formData.dueDate)}
                    readOnly
                    dir="ltr"
                    onClick={() => openDatePicker(dueDateRef.current)}
                    className={cn("app-input text-left pl-12 pr-3 tracking-[0.02em] [font-variant-numeric:lining-nums] [font-family:Arial,Helvetica,sans-serif]", errors.dueDate && "border-destructive")}
                  />
                  <Input
                    ref={dueDateRef}
                    id="dueDate"
                    type="date"
                    lang="en-GB"
                    dir="ltr"
                    value={formData.dueDate}
                    onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                    onClick={() => openDatePicker(dueDateRef.current)}
                    onKeyDown={(e) => e.preventDefault()}
                    onPaste={(e) => e.preventDefault()}
                    className={cn(dateInputClassName, errors.dueDate && "border-destructive")}
                  />
                  <button
                    type="button"
                    onClick={() => openDatePicker(dueDateRef.current)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/15 transition-colors"
                    aria-label="اختيار تاريخ دفع الالتزام"
                  >
                    <Calendar className="h-4 w-4" />
                  </button>
                </div>
                {errors.dueDate && <p className="text-xs text-destructive">{errors.dueDate}</p>}
              </div>
            )}

            {formData.scheduleType === "fixed" && formData.frequency === "monthly" && (
              <div className="app-field">
                <Label htmlFor="dueDay" className="text-right">يوم الدفع <span className="text-destructive">*</span></Label>
                <select
                  id="dueDay"
                  value={formData.dueDay}
                  onChange={(e) => setFormData({ ...formData, dueDay: e.target.value })}
                  className={cn(
                    "app-select text-right",
                    errors.dueDay && "border-destructive"
                  )}
                >
                  <option value="">اختر يوم الدفع</option>
                  {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                    <option key={day} value={day}>{day}</option>
                  ))}
                </select>
                {errors.dueDay && <p className="text-xs text-destructive">{errors.dueDay}</p>}
              </div>
            )}

            {formData.scheduleType === "fixed" && formData.frequency === "yearly" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="app-field">
                  <Label htmlFor="dueDay" className="text-right">يوم الدفع <span className="text-destructive">*</span></Label>
                  <select
                    id="dueDay"
                    value={formData.dueDay}
                    onChange={(e) => setFormData({ ...formData, dueDay: e.target.value })}
                    className={cn(
                      "app-select text-right",
                      errors.dueDay && "border-destructive"
                    )}
                  >
                    <option value="">اختر يوم الدفع</option>
                    {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                  {errors.dueDay && <p className="text-xs text-destructive">{errors.dueDay}</p>}
                </div>
                <div className="app-field">
                  <Label htmlFor="dueMonth" className="text-right">الشهر <span className="text-destructive">*</span></Label>
                  <select
                    id="dueMonth"
                    value={formData.dueMonth}
                    onChange={(e) => setFormData({ ...formData, dueMonth: e.target.value })}
                    className={cn(
                      "app-select",
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

            <div className="app-field">
              <Label htmlFor="walletId" className="text-right">المحفظة المرتبطة</Label>
              <select
                id="walletId"
                value={formData.walletId}
                onChange={(e) => setFormData({ ...formData, walletId: e.target.value })}
                className="app-select"
              >
                <option value="">بدون محفظة</option>
                {wallets?.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
                ))}
              </select>
            </div>

            <div className="app-field">
              <Label htmlFor="categoryId" className="text-right">القسم</Label>
              <select
                id="categoryId"
                value={formData.categoryId}
                onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                className="app-select"
              >
                <option value="">بدون قسم</option>
                {categories?.map((category) => (
                  <option key={category.id} value={category.id}>{category.icon} {category.name}</option>
                ))}
              </select>
            </div>

            <div className="app-field">
              <Label htmlFor="notes" className="text-right">ملاحظات</Label>
              <Input
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="أي ملاحظات إضافية..."
                className="app-input text-right"
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
          </div>

          <DrawerFooter className="shrink-0 border-t border-border/50 bg-background/95 pt-4 pb-5 backdrop-blur">
            <Button 
              onClick={handleSubmit}
              className="h-12 w-full rounded-2xl text-base shadow-lg shadow-primary/20"
              disabled={isSubmitting}
            >
              {isSubmitting ? "جاري الحفظ..." : editingObligation ? "حفظ التغييرات" : "إضافة الالتزام"}
            </Button>
            <DrawerClose asChild>
              <Button type="button" variant="outline" className="h-12 w-full rounded-2xl" disabled={isSubmitting}>إلغاء</Button>
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
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
  return `${formatCurrency(amount)} ر.ع`;
}

// عرض موعد الاستحقاق
function formatDueDate(obligation: Obligation) {
  return formatObligationDueDate(obligation);
}

function getMonthStatusLabel(status: VariableObligationMonthStatus["status"]) {
  if (status === "paid") return "مدفوعة";
  if (status === "late") return "متأخرة";
  return "غير مدفوعة";
}

type ReportFieldKey = "title" | "amount" | "type" | "status" | "frequency" | "startDate" | "endDate" | "dueDate" | "daysLeft";

const reportFieldOptions: Array<{ key: ReportFieldKey; label: string; group: "basic" | "dates" }> = [
  { key: "title", label: "عنوان الالتزام", group: "basic" },
  { key: "amount", label: "المبلغ", group: "basic" },
  { key: "type", label: "النوع", group: "basic" },
  { key: "status", label: "الحالة", group: "basic" },
  { key: "frequency", label: "التكرار", group: "basic" },
  { key: "startDate", label: "تاريخ البداية", group: "dates" },
  { key: "endDate", label: "تاريخ الانتهاء", group: "dates" },
  { key: "dueDate", label: "موعد الاستحقاق", group: "dates" },
  { key: "daysLeft", label: "الأيام المتبقية", group: "dates" },
];

export default function Obligations() {
  const { data: obligations, isLoading } = useObligations();
  const { data: wallets = [] } = useWallets();
  const { data: categories = [] } = useCategories();
  const deleteObligation = useDeleteObligation();
  const toggleObligation = useToggleObligation();
  const { toast } = useToast();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingObligation, setEditingObligation] = useState<Obligation | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [frequencyFilter, setFrequencyFilter] = useState<"all" | "monthly" | "yearly" | "one_time">("all");
  const [timingFilter, setTimingFilter] = useState<"all" | "upcoming" | "auto">("all");
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [reportScope, setReportScope] = useState<"all" | "filtered" | "single">("filtered");
  const [selectedReportObligationId, setSelectedReportObligationId] = useState<number | null>(null);
  const [selectedReportFields, setSelectedReportFields] = useState<ReportFieldKey[]>(["title", "amount", "type", "status", "frequency", "startDate", "endDate", "dueDate", "daysLeft"]);
  const { data: selectedObligationStatuses = [] } = useVariableObligationStatuses(selectedReportObligationId ?? undefined);

  const upcomingObligations = getUpcomingObligations(obligations, 99);
  const upcomingIds = new Set(upcomingObligations.filter((obligation) => obligation.daysLeft <= 30).map((obligation) => obligation.id));

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

  const handleQuickPay = (obligation: Obligation) => {
    if (!obligation.walletId) {
      toast({
        title: "المحفظة مطلوبة",
        description: "اربط الالتزام بمحفظة أولًا حتى نجهز لك عملية الدفع السريعة.",
        variant: "destructive",
      });
      return;
    }

    window.dispatchEvent(new CustomEvent("open-add-transaction", {
      detail: {
        type: "expense",
        amount: obligation.amount.toString(),
        note: obligation.title,
        categoryId: obligation.categoryId?.toString() || "",
        walletId: obligation.walletId.toString(),
        obligationId: obligation.id.toString(),
        obligationScheduleType: obligation.scheduleType,
      },
    }));

    toast({
      title: "تم تجهيز الدفع",
      description: "فتحنا نموذج المعاملة مع تعبئة بيانات الالتزام لسرعة التسجيل.",
    });
  };

  // حساب الإحصائيات
  const activeObligations = (obligations || []).filter((o) => o.isActive);
  const totalMonthlyAmount = activeObligations
    .filter((o) => o.frequency === "monthly")
    .reduce((sum, o) => sum + o.amount, 0);
  const inactiveObligations = (obligations || []).filter((o) => !o.isActive);
  const autoCreateCount = activeObligations.filter((o) => o.autoCreateTransaction).length;
  const dueSoonCount = upcomingObligations.filter((o) => o.daysLeft <= 7).length;
  const filteredObligations = (obligations || []).filter((obligation) => {
    if (statusFilter === "active" && !obligation.isActive) return false;
    if (statusFilter === "inactive" && obligation.isActive) return false;
    if (frequencyFilter !== "all" && obligation.frequency !== frequencyFilter) return false;
    if (timingFilter === "upcoming" && !upcomingIds.has(obligation.id)) return false;
    if (timingFilter === "auto" && !obligation.autoCreateTransaction) return false;
    return true;
  });
  const allObligations = obligations || [];
  const reportObligations = reportScope === "all"
    ? allObligations
    : reportScope === "single"
      ? allObligations.filter((obligation) => obligation.id === selectedReportObligationId)
      : filteredObligations;
  const selectedReportObligation = reportObligations.length === 1 ? reportObligations[0] : null;
  const selectedReportWalletName = selectedReportObligation ? wallets.find((wallet) => wallet.id === selectedReportObligation.walletId)?.name ?? "بدون محفظة" : "";
  const selectedReportCategoryName = selectedReportObligation ? categories.find((category) => category.id === selectedReportObligation.categoryId)?.name ?? "بدون تصنيف" : "";
  const paidStatusesCount = selectedObligationStatuses.filter((item) => item.status === "paid").length;
  const lateStatusesCount = selectedObligationStatuses.filter((item) => item.status === "late").length;
  const totalPaidAmount = selectedReportObligation ? paidStatusesCount * selectedReportObligation.amount : 0;
  const printableStatuses = useMemo(() => selectedObligationStatuses.slice(0, 12), [selectedObligationStatuses]);

  const toggleReportField = (field: ReportFieldKey) => {
    setSelectedReportFields((current) => current.includes(field)
      ? current.filter((item) => item !== field)
      : [...current, field]);
  };

  const handleOpenSingleReport = (obligationId: number) => {
    setReportScope("single");
    setSelectedReportObligationId(obligationId);
    setIsReportDialogOpen(true);
  };

  const handleOpenGeneralReport = () => {
    setReportScope("filtered");
    setSelectedReportObligationId(filteredObligations[0]?.id ?? null);
    setIsReportDialogOpen(true);
  };

  const handlePrintReport = () => {
    document.body.classList.add("print-report-active");
    window.print();
    window.setTimeout(() => {
      document.body.classList.remove("print-report-active");
    }, 150);
  };

  const getReportStatus = (obligation: Obligation) => getObligationStatusLabel(obligation);

  const getReportDaysLeft = (obligation: Obligation) => {
    const upcoming = upcomingObligations.find((item) => item.id === obligation.id);
    if (!upcoming) return "غير متاح";
    if (upcoming.daysLeft === 0) return "مستحق اليوم";
    if (upcoming.daysLeft === 1) return "مستحق غداً";
    return `بعد ${upcoming.daysLeft} يوم`;
  };

  if (isLoading) {
    return (
      <div className="bg-background animate-in fade-in duration-300">
        <header className="px-4 py-6 pb-4 bg-background sticky top-0 z-10 border-b border-border/50">
          <h1 className="text-2xl font-bold">الالتزامات</h1>
        </header>
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-300">
      <header className="px-1 py-4 pb-3 sm:px-2 sm:py-6 xl:px-0">
        <div className="overflow-hidden rounded-[28px] border border-border/60 bg-gradient-to-b from-background via-background to-muted/30 shadow-sm">
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="min-w-0 space-y-2">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
                <Receipt className="h-3.5 w-3.5" />
                متابعة ذكية للالتزامات
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">الالتزامات</h1>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">تابع ما يجب دفعه، وما هو قريب الاستحقاق، وسجّل الدفعات بسرعة من نفس الصفحة.</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 hide-on-print sm:flex-row sm:items-center">
              <Button type="button" variant="outline" className="h-11 w-full rounded-2xl border-border/70 bg-background/80 px-4 sm:w-auto" onClick={handleOpenGeneralReport}>
                <Printer className="h-4 w-4 ml-1" />
                طباعة / PDF
              </Button>
              <Button 
                className="h-11 w-full rounded-2xl px-5 shadow-md shadow-primary/20 bg-primary text-primary-foreground cursor-pointer sm:w-auto"
                onClick={() => handleAdd()}
              >
                <Plus className="h-5 w-5" />
                إضافة التزام
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-border/50 bg-muted/20 p-3 sm:p-4">
            <div className="rounded-2xl bg-background/80 px-3 py-3 text-center shadow-sm">
              <div className="text-xs text-muted-foreground">النشطة</div>
              <div className="mt-1 text-lg font-bold">{activeObligations.length}</div>
            </div>
            <div className="rounded-2xl bg-background/80 px-3 py-3 text-center shadow-sm">
              <div className="text-xs text-muted-foreground">قريبة</div>
              <div className="mt-1 text-lg font-bold text-amber-600 dark:text-amber-400">{dueSoonCount}</div>
            </div>
            <div className="rounded-2xl bg-background/80 px-3 py-3 text-center shadow-sm">
              <div className="text-xs text-muted-foreground">تلقائي</div>
              <div className="mt-1 text-lg font-bold text-primary">{autoCreateCount}</div>
            </div>
          </div>
        </div>
      </header>

      <div className="px-1 pb-24 sm:px-2 xl:px-0">
        {obligations?.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-border/60 bg-gradient-to-b from-muted/20 to-background px-5 py-14 text-center shadow-sm">
            <div className="mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-primary/10 shadow-inner shadow-primary/10">
              <Receipt className="h-11 w-11 text-primary" />
            </div>
            <h3 className="text-2xl font-bold">لا توجد التزامات</h3>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground sm:text-base">
              أضف التزاماتك المالية لتتبع مواعيد الاستحقاق والمبالغ وتنظيم دفعاتك القادمة من مكان واحد.
            </p>
            <div className="mx-auto mt-6 grid max-w-md gap-3 text-right sm:grid-cols-3">
              <div className="rounded-2xl border border-border/60 bg-background/80 p-3 text-center shadow-sm">
                <div className="text-lg font-bold text-primary">1</div>
                <div className="mt-1 text-xs text-muted-foreground">أضف العنوان والمبلغ</div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/80 p-3 text-center shadow-sm">
                <div className="text-lg font-bold text-primary">2</div>
                <div className="mt-1 text-xs text-muted-foreground">حدد التكرار والموعد</div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/80 p-3 text-center shadow-sm">
                <div className="text-lg font-bold text-primary">3</div>
                <div className="mt-1 text-xs text-muted-foreground">اربطه بمحفظة أو قسم</div>
              </div>
            </div>
            <Button 
              className="mt-7 h-12 rounded-2xl px-6 shadow-md shadow-primary/20"
              onClick={() => handleAdd()}
            >
              <Plus className="h-5 w-5 ml-2" />
              إضافة أول التزام
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Card className="border border-emerald-200/60 shadow-sm bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center">
                      <Power className="h-4 w-4 text-emerald-600" />
                    </div>
                    <span className="text-sm text-muted-foreground">النشطة</span>
                  </div>
                  <div className="text-2xl font-bold">{activeObligations.length}</div>
                </CardContent>
              </Card>
              
              <Card className="border border-destructive/10 shadow-sm bg-destructive/5">
                <CardContent className="p-4 sm:p-5">
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
              <Card className="border border-amber-200/60 shadow-sm bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/20">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900 flex items-center justify-center">
                      <AlertCircle className="h-4 w-4 text-amber-600" />
                    </div>
                    <span className="text-sm text-muted-foreground">خلال 7 أيام</span>
                  </div>
                  <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">{dueSoonCount}</div>
                </CardContent>
              </Card>
              <Card className="border border-primary/10 shadow-sm bg-primary/5">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Sparkles className="h-4 w-4 text-primary" />
                    </div>
                    <span className="text-sm text-muted-foreground">تلقائي</span>
                  </div>
                  <div className="text-2xl font-bold text-primary">{autoCreateCount}</div>
                </CardContent>
              </Card>
            </div>

            <Card className="overflow-hidden border border-border/50 shadow-sm">
              <CardContent className="space-y-4 p-4 sm:p-5">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Filter className="h-4 w-4 text-primary" />
                  تصفية الالتزامات
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">الحالة</p>
                    <div className="flex flex-wrap gap-2">
                      {[{ value: "all", label: "الكل" }, { value: "active", label: `النشطة (${activeObligations.length})` }, { value: "inactive", label: `المتوقفة (${inactiveObligations.length})` }].map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => setStatusFilter(item.value as typeof statusFilter)}
                          className={cn(
                            "px-3 py-2 rounded-2xl text-sm border transition-all shadow-sm",
                            statusFilter === item.value ? "border-primary bg-primary/10 text-primary font-medium shadow-primary/10" : "border-border/50 bg-background hover:bg-muted/50"
                          )}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">التكرار</p>
                    <div className="flex flex-wrap gap-2">
                      {[{ value: "all", label: "الكل" }, { value: "monthly", label: "شهري" }, { value: "yearly", label: "سنوي" }, { value: "one_time", label: "مرة واحدة" }].map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => setFrequencyFilter(item.value as typeof frequencyFilter)}
                          className={cn(
                            "px-3 py-2 rounded-2xl text-sm border transition-all shadow-sm",
                            frequencyFilter === item.value ? "border-primary bg-primary/10 text-primary font-medium shadow-primary/10" : "border-border/50 bg-background hover:bg-muted/50"
                          )}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">التركيز</p>
                    <div className="flex flex-wrap gap-2">
                      {[{ value: "all", label: "كل الالتزامات" }, { value: "upcoming", label: "القريبة" }, { value: "auto", label: "التلقائية" }].map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => setTimingFilter(item.value as typeof timingFilter)}
                          className={cn(
                            "px-3 py-2 rounded-2xl text-sm border transition-all shadow-sm",
                            timingFilter === item.value ? "border-primary bg-primary/10 text-primary font-medium shadow-primary/10" : "border-border/50 bg-background hover:bg-muted/50"
                          )}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* الالتزامات القادمة */}
            {upcomingObligations.filter((obligation) => obligation.daysLeft <= 30).length > 0 && (
              <div>
                <h2 className="font-bold text-lg mb-3 flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-amber-500" />
                  الالتزامات القادمة
                </h2>
                <div className="flex flex-col gap-2">
                  {upcomingObligations.filter((obligation) => obligation.daysLeft <= 30).slice(0, 3).map((obligation) => (
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
                              {formatDueDate(obligation)}
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
              <div className="flex items-center justify-between mb-3 gap-3">
                <h2 className="font-bold text-lg">جميع الالتزامات</h2>
                <span className="text-xs text-muted-foreground">{filteredObligations.length} نتيجة</span>
              </div>
              <div className="flex flex-col gap-3">
                {filteredObligations.length > 0 ? filteredObligations.map((obligation) => {
                  const walletName = wallets.find((wallet) => wallet.id === obligation.walletId)?.name;
                  const categoryName = categories.find((category) => category.id === obligation.categoryId)?.name;
                  const upcoming = upcomingObligations.find((item) => item.id === obligation.id);
                  const statusLabel = getObligationStatusLabel(obligation);
                  const ended = isObligationEnded(obligation);
                  return (
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
                          <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-muted-foreground">
                            {obligationTypeLabels[obligation.obligationType]}
                            <span className="px-2 py-0.5 rounded-full bg-muted text-foreground font-medium">
                              {obligation.scheduleType === "fixed" ? "ثابت" : "متغير"}
                            </span>
                            {obligation.autoCreateTransaction ? (
                              <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">تلقائي</span>
                            ) : null}
                            {upcoming && upcoming.daysLeft <= 7 ? (
                              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium dark:bg-amber-950 dark:text-amber-400">قريب</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="text-left shrink-0">
                        <span className="font-bold text-destructive text-sm">
                          {formatAmount(obligation.amount)}
                        </span>
                      </div>
                    </div>

                    {/* الصف الثاني: التفاصيل والأزرار */}
                    <div className="space-y-3 pt-3 border-t border-border/50">
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {formatDueDate(obligation)}
                        </span>
                        <span>{obligation.scheduleType === "fixed" ? frequencyLabels[obligation.frequency] : "متغير"}</span>
                        <span>البداية: {formatDate(obligation.startDate)}</span>
                        {obligation.endDate ? <span>الانتهاء: {formatDate(obligation.endDate)}</span> : <span>بدون انتهاء</span>}
                        {walletName ? <span>المحفظة: {walletName}</span> : <span>بدون محفظة</span>}
                        {categoryName ? <span>القسم: {categoryName}</span> : null}
                        <span className={cn("font-medium", ended ? "text-amber-600" : obligation.isActive ? "text-emerald-600" : "text-slate-400")}>
                          • {statusLabel}
                        </span>
                        {upcoming ? (
                          <span className="text-amber-600 font-medium">
                            {upcoming.daysLeft === 0 ? "مستحق اليوم" : upcoming.daysLeft === 1 ? "مستحق غداً" : `بعد ${upcoming.daysLeft} يوم`}
                          </span>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {obligation.scheduleType === "variable" ? (
                          <Link href={`/obligations/${obligation.id}`}>
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-full"
                            >
                              <Calendar className="h-4 w-4 ml-1" />
                              تفاصيل المتابعة
                            </Button>
                          </Link>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() => handleQuickPay(obligation)}
                        >
                          <ArrowLeftRight className="h-4 w-4 ml-1" />
                          تسجيل دفعة
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full hide-on-print"
                          onClick={() => handleOpenSingleReport(obligation.id)}
                        >
                          <Printer className="h-4 w-4 ml-1" />
                          طباعة التقرير
                        </Button>
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
                )}) : (
                  <div className="text-center py-10 bg-muted/20 rounded-2xl border border-dashed border-border/50">
                    <Filter className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-muted-foreground font-medium">لا توجد نتائج مطابقة</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">جرّب تغيير الفلاتر أو أضف التزامًا جديدًا.</p>
                  </div>
                )}
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

      <Dialog open={isReportDialogOpen} onOpenChange={setIsReportDialogOpen}>
        <DialogContent dir="rtl" className="max-w-5xl overflow-hidden p-0">
          <DialogHeader className="hide-on-print px-6 pt-6 text-right">
            <DialogTitle>إعداد تقرير الالتزامات</DialogTitle>
            <DialogDescription>
              اختر نطاق التقرير والحقول المطلوبة ثم اطبع التقرير أو احفظه بصيغة PDF.
            </DialogDescription>
          </DialogHeader>

          <div className="grid overflow-hidden md:grid-cols-[320px_minmax(0,1fr)]" style={{ maxHeight: "calc(var(--app-viewport-height, 100vh) * 0.8)" }}>
            <div className="hide-on-print overflow-y-auto border-b p-6 md:border-b-0 md:border-l">
              <div className="space-y-6">
                <div className="space-y-3">
                  <p className="text-sm font-semibold">نطاق التقرير</p>
                  <div className="grid gap-2">
                    {[
                      { value: "filtered", label: `الالتزامات الحالية بعد الفلترة (${filteredObligations.length})` },
                      { value: "all", label: `كل الالتزامات (${obligations?.length ?? 0})` },
                      { value: "single", label: "التزام واحد" },
                    ].map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => setReportScope(item.value as typeof reportScope)}
                        className={cn(
                          "rounded-2xl border px-4 py-3 text-right text-sm transition-all",
                          reportScope === item.value ? "border-primary bg-primary/10 text-primary" : "border-border/50 hover:bg-muted/40"
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {reportScope === "single" ? (
                  <div className="space-y-2">
                    <Label htmlFor="report-obligation">الالتزام المطلوب</Label>
                    <select
                      id="report-obligation"
                      value={selectedReportObligationId ?? ""}
                      onChange={(e) => setSelectedReportObligationId(e.target.value ? Number(e.target.value) : null)}
                      className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                    >
                      <option value="">اختر الالتزام</option>
                      {allObligations.map((obligation) => (
                        <option key={obligation.id} value={obligation.id}>{obligation.title}</option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold">البيانات الأساسية</p>
                    <div className="mt-3 space-y-3">
                      {reportFieldOptions.filter((item) => item.group === "basic").map((item) => (
                        <label key={item.key} className="flex items-center gap-3 text-sm">
                          <Checkbox checked={selectedReportFields.includes(item.key)} onCheckedChange={() => toggleReportField(item.key)} />
                          <span>{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-semibold">التواريخ والاستحقاق</p>
                    <div className="mt-3 space-y-3">
                      {reportFieldOptions.filter((item) => item.group === "dates").map((item) => (
                        <label key={item.key} className="flex items-center gap-3 text-sm">
                          <Checkbox checked={selectedReportFields.includes(item.key)} onCheckedChange={() => toggleReportField(item.key)} />
                          <span>{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setIsReportDialogOpen(false)}>
                    إغلاق
                  </Button>
                  <Button type="button" onClick={handlePrintReport} disabled={reportObligations.length === 0 || selectedReportFields.length === 0 || (reportScope === "single" && !selectedReportObligationId)}>
                    <Printer className="h-4 w-4" />
                    طباعة / PDF
                  </Button>
                </div>
              </div>
            </div>

            <div className="overflow-y-auto bg-muted/20 p-4 sm:p-6" style={{ maxHeight: "calc(var(--app-viewport-height, 100vh) * 0.8)" }}>
              <div className="print-report-root mx-auto max-w-3xl space-y-6 rounded-3xl bg-background p-6 sm:p-8">
                <div className="print-break-avoid rounded-3xl border bg-card p-6">
                  <div className="flex items-start justify-between gap-4 border-b pb-4">
                    <div className="space-y-2 text-right">
                      <h2 className="text-2xl font-bold">{reportScope === "single" ? "فاتورة الالتزام" : "تقرير الالتزامات"}</h2>
                      <p className="text-sm text-muted-foreground">
                        {reportScope === "single" ? "مستند تفصيلي للالتزام والدفعات المرتبطة به" : reportScope === "all" ? "تقرير جميع الالتزامات" : "تقرير الالتزامات المفلترة"}
                      </p>
                    </div>
                    <div className="text-left text-sm text-muted-foreground">
                      <p>عدد السجلات: {reportObligations.length}</p>
                      <p>تاريخ الإنشاء: {new Date().toLocaleString("ar-OM")}</p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full border px-3 py-1">الحالة: {statusFilter === "all" ? "الكل" : statusFilter === "active" ? "النشطة" : "المتوقفة"}</span>
                    <span className="rounded-full border px-3 py-1">التكرار: {frequencyFilter === "all" ? "الكل" : frequencyLabels[frequencyFilter]}</span>
                    <span className="rounded-full border px-3 py-1">التركيز: {timingFilter === "all" ? "الكل" : timingFilter === "upcoming" ? "القريبة" : "التلقائية"}</span>
                  </div>
                </div>

                {reportScope === "single" && selectedReportObligation ? (
                  <div className="print-break-avoid rounded-3xl border bg-card p-6">
                    <div className="flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn("flex h-14 w-14 items-center justify-center rounded-3xl text-3xl", obligationTypeColors[selectedReportObligation.obligationType])}>
                          {obligationTypeIcons[selectedReportObligation.obligationType]}
                        </div>
                        <div>
                          <h3 className="text-xl font-bold">{selectedReportObligation.title}</h3>
                          <p className="text-sm text-muted-foreground">{obligationTypeLabels[selectedReportObligation.obligationType]} • {selectedReportObligation.scheduleType === "fixed" ? frequencyLabels[selectedReportObligation.frequency] : "متغير"}</p>
                        </div>
                      </div>
                      <div className="text-right sm:text-left">
                        <p className="text-xs text-muted-foreground">المبلغ الدوري</p>
                        <p className="mt-1 text-xl font-bold text-destructive">{formatAmount(selectedReportObligation.amount)}</p>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border p-4 text-sm"><p className="text-xs text-muted-foreground">الحالة</p><p className="mt-2 font-semibold">{getReportStatus(selectedReportObligation)}</p></div>
                      <div className="rounded-2xl border p-4 text-sm"><p className="text-xs text-muted-foreground">موعد الاستحقاق</p><p className="mt-2 font-semibold">{formatDueDate(selectedReportObligation)}</p></div>
                      <div className="rounded-2xl border p-4 text-sm"><p className="text-xs text-muted-foreground">المحفظة</p><p className="mt-2 font-semibold">{selectedReportWalletName}</p></div>
                      <div className="rounded-2xl border p-4 text-sm"><p className="text-xs text-muted-foreground">التصنيف</p><p className="mt-2 font-semibold">{selectedReportCategoryName}</p></div>
                      <div className="rounded-2xl border p-4 text-sm"><p className="text-xs text-muted-foreground">تاريخ البداية</p><p className="mt-2 font-semibold">{formatDate(selectedReportObligation.startDate)}</p></div>
                      <div className="rounded-2xl border p-4 text-sm"><p className="text-xs text-muted-foreground">الانتهاء</p><p className="mt-2 font-semibold">{selectedReportObligation.endDate ? formatDate(selectedReportObligation.endDate) : "بدون انتهاء"}</p></div>
                    </div>
                  </div>
                ) : null}

                {reportScope === "single" && selectedReportObligation ? (
                  <div className="print-break-avoid rounded-3xl border bg-card p-6">
                    <h3 className="text-lg font-bold">الدفعات / حالة السداد</h3>
                    {selectedReportObligation.scheduleType === "variable" ? (
                      <>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <div className="rounded-2xl border p-4 text-sm"><p className="text-xs text-muted-foreground">الأشهر المدفوعة</p><p className="mt-2 text-lg font-bold text-emerald-600">{paidStatusesCount}</p></div>
                          <div className="rounded-2xl border p-4 text-sm"><p className="text-xs text-muted-foreground">الأشهر المتأخرة</p><p className="mt-2 text-lg font-bold text-amber-600">{lateStatusesCount}</p></div>
                          <div className="rounded-2xl border p-4 text-sm"><p className="text-xs text-muted-foreground">إجمالي المدفوع</p><p className="mt-2 text-lg font-bold">{formatCurrency(totalPaidAmount, 2)} ر.ع</p></div>
                        </div>

                        <div className="mt-4 overflow-hidden rounded-3xl border">
                          <div className="grid grid-cols-[1.1fr_1fr_1fr] border-b bg-muted/40 text-sm font-medium">
                            <div className="border-l px-4 py-3">الشهر</div>
                            <div className="border-l px-4 py-3">الحالة</div>
                            <div className="px-4 py-3">تاريخ السداد</div>
                          </div>
                          {printableStatuses.length > 0 ? printableStatuses.map((item) => (
                            <div key={item.id} className="grid grid-cols-[1.1fr_1fr_1fr] border-b last:border-b-0 text-sm">
                              <div className="border-l px-4 py-3">{item.monthKey}</div>
                              <div className="border-l px-4 py-3">{getMonthStatusLabel(item.status)}</div>
                              <div className="px-4 py-3 text-muted-foreground">{item.paidAt ? formatDate(item.paidAt) : "غير مسجل"}</div>
                            </div>
                          )) : (
                            <div className="px-4 py-6 text-center text-sm text-muted-foreground">لا توجد دفعات مسجلة لهذا الالتزام المتغير حتى الآن.</div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="mt-4 rounded-3xl border p-4 text-sm text-muted-foreground">
                        هذا الالتزام من النوع الثابت، لذلك لا توجد قائمة دفعات شهرية مرتبطة محفوظة حاليًا. يمكنك استخدام هذه الفاتورة كمرجع واضح لبيانات الالتزام ومبلغ السداد المتوقع.
                      </div>
                    )}
                  </div>
                ) : null}

                {reportObligations.length > 0 ? reportObligations.map((obligation) => {
                  const upcoming = upcomingObligations.find((item) => item.id === obligation.id);
                  const walletName = wallets.find((wallet) => wallet.id === obligation.walletId)?.name;
                  const categoryName = categories.find((category) => category.id === obligation.categoryId)?.name;
                  return (
                    <div key={`${obligation.id}-report`} className="print-break-avoid rounded-3xl border bg-card p-6">
                      <div className="flex items-center justify-between gap-4 border-b pb-4">
                        <div className="flex items-center gap-3">
                          <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl text-2xl", obligationTypeColors[obligation.obligationType])}>
                            {obligationTypeIcons[obligation.obligationType]}
                          </div>
                          <div>
                            <h3 className="text-lg font-bold">{obligation.title}</h3>
                            <p className="text-sm text-muted-foreground">{obligationTypeLabels[obligation.obligationType]}</p>
                          </div>
                        </div>
                        {selectedReportFields.includes("amount") ? <span className="text-lg font-bold text-destructive">{formatAmount(obligation.amount)}</span> : null}
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {selectedReportFields.includes("title") ? <div className="rounded-2xl border p-4 text-sm"><p className="text-xs text-muted-foreground">العنوان</p><p className="mt-2 font-semibold">{obligation.title}</p></div> : null}
                        {selectedReportFields.includes("type") ? <div className="rounded-2xl border p-4 text-sm"><p className="text-xs text-muted-foreground">النوع</p><p className="mt-2 font-semibold">{obligationTypeLabels[obligation.obligationType]}</p></div> : null}
                        {selectedReportFields.includes("status") ? <div className="rounded-2xl border p-4 text-sm"><p className="text-xs text-muted-foreground">الحالة</p><p className="mt-2 font-semibold">{getReportStatus(obligation)}</p></div> : null}
                        {selectedReportFields.includes("frequency") ? <div className="rounded-2xl border p-4 text-sm"><p className="text-xs text-muted-foreground">التكرار</p><p className="mt-2 font-semibold">{obligation.scheduleType === "fixed" ? frequencyLabels[obligation.frequency] : "متغير"}</p></div> : null}
                        {selectedReportFields.includes("startDate") ? <div className="rounded-2xl border p-4 text-sm"><p className="text-xs text-muted-foreground">تاريخ البداية</p><p className="mt-2 font-semibold">{formatDate(obligation.startDate)}</p></div> : null}
                        {selectedReportFields.includes("endDate") ? <div className="rounded-2xl border p-4 text-sm"><p className="text-xs text-muted-foreground">تاريخ الانتهاء</p><p className="mt-2 font-semibold">{obligation.endDate ? formatDate(obligation.endDate) : "بدون انتهاء"}</p></div> : null}
                        {selectedReportFields.includes("dueDate") ? <div className="rounded-2xl border p-4 text-sm"><p className="text-xs text-muted-foreground">موعد الاستحقاق</p><p className="mt-2 font-semibold">{formatDueDate(obligation)}</p></div> : null}
                        {selectedReportFields.includes("daysLeft") ? <div className="rounded-2xl border p-4 text-sm"><p className="text-xs text-muted-foreground">الأيام المتبقية</p><p className="mt-2 font-semibold">{getReportDaysLeft(obligation)}</p></div> : null}
                        {reportScope !== "single" ? <div className="rounded-2xl border p-4 text-sm"><p className="text-xs text-muted-foreground">المحفظة</p><p className="mt-2 font-semibold">{walletName || "بدون محفظة"}</p></div> : null}
                        {reportScope !== "single" ? <div className="rounded-2xl border p-4 text-sm"><p className="text-xs text-muted-foreground">التصنيف</p><p className="mt-2 font-semibold">{categoryName || "بدون تصنيف"}</p></div> : null}
                      </div>

                      {upcoming ? <p className="mt-4 text-sm text-amber-600">{upcoming.daysLeft <= 7 ? "هذا الالتزام قريب من الاستحقاق." : "الالتزام مجدول ضمن قائمة الالتزامات القادمة."}</p> : null}
                    </div>
                  );
                }) : (
                  <div className="rounded-3xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
                    لا توجد بيانات مطابقة لإعدادات التقرير الحالية.
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
