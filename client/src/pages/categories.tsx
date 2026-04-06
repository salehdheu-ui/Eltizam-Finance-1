import { Plus, GripVertical, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
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
import { cn } from "@/lib/utils";
import { useCategories, useCreateCategory, useDeleteCategory } from "@/lib/hooks";
import type { Category } from "@shared/schema";

const iconOptions = ["🍔", "🚗", "🏠", "📄", "💊", "🛍️", "💰", "💻", "📈", "✈️", "🎮", "📚", "☕", "👕", "🎁", "📝"];

const typeColors: Record<string, string> = {
  expense: "bg-orange-100 text-orange-600",
  income: "bg-emerald-100 text-emerald-600",
  debt: "bg-rose-100 text-rose-600",
};

export default function Categories() {
  const { toast } = useToast();
  const { data: allCategories = [], isLoading } = useCategories();
  const createCategory = useCreateCategory();
  const deleteCategory = useDeleteCategory();
  const [activeTab, setActiveTab] = useState("expense");
  
  const [isAddDrawerOpen, setIsAddDrawerOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [selectedIcon, setSelectedIcon] = useState("📝");
  const [newBudget, setNewBudget] = useState("");

  const categoriesByType = {
    expense: allCategories.filter(c => c.type === "expense"),
    income: allCategories.filter(c => c.type === "income"),
    debt: allCategories.filter(c => c.type === "debt"),
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName) return;
    try {
      await createCategory.mutateAsync({
        name: newCategoryName,
        icon: selectedIcon,
        type: activeTab,
        color: typeColors[activeTab] || typeColors.expense,
        budget: parseFloat(newBudget) || 0,
      });
      setIsAddDrawerOpen(false);
      setNewCategoryName("");
      setNewBudget("");
      toast({ title: "تمت الإضافة", description: `تمت إضافة قسم "${newCategoryName}" بنجاح` });
    } catch {
      toast({ title: "خطأ", description: "فشل إضافة القسم", variant: "destructive" });
    }
  };

  const handleDeleteCategory = async (id: number) => {
    try {
      await deleteCategory.mutateAsync(id);
      toast({ title: "تم الحذف", description: "تم حذف القسم بنجاح" });
    } catch {
      toast({ title: "خطأ", description: "فشل حذف القسم", variant: "destructive" });
    }
  };

  const renderCategoryList = (cats: Category[]) => (
    <div className="flex flex-col gap-3">
      {cats.length > 0 ? (
        cats.map((cat) => (
          <div key={cat.id} className="bg-card p-3.5 rounded-2xl border border-border/50 shadow-sm flex items-center justify-between hover-elevate transition-all" data-testid={`card-category-${cat.id}`}>
            <div className="flex items-center gap-3">
              <div className={`h-12 w-12 rounded-2xl flex items-center justify-center text-2xl ${cat.color} bg-opacity-20`}>
                {cat.icon}
              </div>
              <div>
                <h4 className="font-bold">{cat.name}</h4>
                {cat.budget && cat.budget > 0 ? (
                  <p className="text-xs text-muted-foreground mt-0.5">الميزانية: {cat.budget} ر.ع</p>
                ) : null}
              </div>
            </div>
            <Button 
              variant="ghost" 
              size="icon"
              className="text-muted-foreground/50 hover:text-destructive"
              onClick={() => handleDeleteCategory(cat.id)}
              data-testid={`button-delete-cat-${cat.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))
      ) : (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-3">
            <span className="text-2xl">📝</span>
          </div>
          <h3 className="font-bold text-lg mb-1">لا توجد أقسام</h3>
          <p className="text-sm text-muted-foreground mb-4">أضف قسم جديد للبدء</p>
          <Button variant="outline" onClick={() => setIsAddDrawerOpen(true)}>إضافة قسم</Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="animate-in fade-in duration-300">
      <header className="px-4 py-6 pb-2">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">الأقسام</h1>
          <Button 
            size="icon" 
            className="rounded-full shadow-md bg-primary text-primary-foreground cursor-pointer"
            onClick={() => setIsAddDrawerOpen(true)}
            data-testid="button-add-category"
          >
            <Plus className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <div className="flex-1 px-4 pb-24">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full" dir="rtl">
            <TabsList className="w-full mb-6 bg-muted/50 p-1 rounded-xl h-auto">
              <TabsTrigger value="expense" className="flex-1 rounded-lg py-2.5" data-testid="tab-expense-cat">المصروفات</TabsTrigger>
              <TabsTrigger value="income" className="flex-1 rounded-lg py-2.5" data-testid="tab-income-cat">الدخل</TabsTrigger>
              <TabsTrigger value="debt" className="flex-1 rounded-lg py-2.5" data-testid="tab-debt-cat">الديون</TabsTrigger>
            </TabsList>

            <TabsContent value="expense" className="mt-0 outline-none">
              {renderCategoryList(categoriesByType.expense)}
            </TabsContent>
            <TabsContent value="income" className="mt-0 outline-none">
              {renderCategoryList(categoriesByType.income)}
            </TabsContent>
            <TabsContent value="debt" className="mt-0 outline-none">
              {renderCategoryList(categoriesByType.debt)}
            </TabsContent>
          </Tabs>
        )}
      </div>

      <Drawer open={isAddDrawerOpen} onOpenChange={setIsAddDrawerOpen}>
        <DrawerContent dir="rtl">
          <div className="mx-auto w-full max-w-sm">
            <DrawerHeader>
              <DrawerTitle>إضافة قسم جديد</DrawerTitle>
              <DrawerDescription>
                سيتم إضافة القسم تحت قائمة {activeTab === 'expense' ? "المصروفات" : activeTab === 'income' ? "الدخل" : "الديون"}
              </DrawerDescription>
            </DrawerHeader>
            <form onSubmit={handleAddCategory} className="p-4 pb-0 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="category-name" className="text-right">اسم القسم</Label>
                <Input id="category-name" placeholder="مثال: بقالة، ترفيه، جمعية" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} className="text-right" required />
              </div>
              {activeTab === "expense" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="budget" className="text-right">الميزانية الشهرية (اختياري)</Label>
                  <Input id="budget" type="number" placeholder="0.00" value={newBudget} onChange={(e) => setNewBudget(e.target.value)} className="text-right" />
                </div>
              )}
              <div className="flex flex-col gap-3 mt-2">
                <Label className="text-right">اختر أيقونة</Label>
                <div className="grid grid-cols-8 gap-2">
                  {iconOptions.map((icon) => (
                    <button key={icon} type="button" onClick={() => setSelectedIcon(icon)}
                      className={cn("h-10 w-10 text-xl flex items-center justify-center rounded-xl transition-all",
                        selectedIcon === icon ? "bg-primary/10 border-2 border-primary" : "bg-muted/50 border border-transparent hover:bg-muted"
                      )}>
                      {icon}
                    </button>
                  ))}
                </div>
              </div>
            </form>
            <DrawerFooter>
              <Button onClick={handleAddCategory} className="w-full" disabled={createCategory.isPending}>
                {createCategory.isPending ? "جاري الإضافة..." : "إضافة"}
              </Button>
              <DrawerClose asChild><Button variant="outline" className="w-full">إلغاء</Button></DrawerClose>
            </DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
