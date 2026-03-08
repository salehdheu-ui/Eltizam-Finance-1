import { ArrowDownLeft, ArrowUpRight, Eye, EyeOff, Settings, Loader2, Receipt, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { useDashboard, useUser, useObligations } from "@/lib/hooks";
import type { Obligation } from "@shared/schema";

// نوع ممتد للالتزامات القادمة مع حقل الأيام المتبقية
type UpcomingObligation = Obligation & { daysLeft: number };

const categoryColors: Record<string, { icon: string; bg: string }> = {
  "طعام": { icon: "🍔", bg: "bg-orange-100 dark:bg-orange-950" },
  "وقود": { icon: "⛽", bg: "bg-blue-100 dark:bg-blue-950" },
  "إيجار": { icon: "🏠", bg: "bg-indigo-100 dark:bg-indigo-950" },
  "راتب": { icon: "💰", bg: "bg-emerald-100 dark:bg-emerald-950" },
  "صحة": { icon: "💊", bg: "bg-red-100 dark:bg-red-950" },
  "تسوق": { icon: "🛍️", bg: "bg-pink-100 dark:bg-pink-950" },
  "فواتير": { icon: "📄", bg: "bg-yellow-100 dark:bg-yellow-950" },
};

function formatDate(date: string | Date | number) {
  let d: Date;
  if (typeof date === "number") {
    d = new Date(date * 1000);
  } else if (typeof date === "string") {
    const num = parseInt(date);
    if (!isNaN(num) && num > 1000000000) {
      d = new Date(num * 1000);
    } else {
      d = new Date(date);
    }
  } else {
    d = new Date(date);
  }
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "اليوم";
  if (days === 1) return "أمس";
  return d.toLocaleDateString("ar-OM", { day: "numeric", month: "long" });
}

// Helper: حساب الالتزامات القادمة
function getUpcomingObligations(obligations: Obligation[] | undefined, limit: number = 5): UpcomingObligation[] {
  if (!obligations) return [];
  
  const now = new Date();
  const currentDay = now.getDate();
  const currentMonth = now.getMonth() + 1;
  
  // حساب أيام متبقية لكل التزام نشط
  const obligationsWithDaysLeft = obligations
    .filter(o => o.isActive)
    .map(o => {
      let daysLeft = 0;
      
      if (o.frequency === "monthly" && o.dueDay) {
        // حساب الأيام المتبقية حتى يوم الاستحقاق الشهري
        daysLeft = o.dueDay - currentDay;
        if (daysLeft < 0) {
          daysLeft += 30; // تقريباً لشهر قادم
        }
      } else if (o.frequency === "yearly" && o.dueMonth && o.dueDay) {
        // حساب الأيام المتبقية للالتزام السنوي
        const monthsLeft = o.dueMonth - currentMonth;
        if (monthsLeft < 0) {
          daysLeft = (12 + monthsLeft) * 30 + (o.dueDay - currentDay);
        } else if (monthsLeft === 0) {
          daysLeft = o.dueDay - currentDay;
          if (daysLeft < 0) daysLeft += 365; // العام القادم
        } else {
          daysLeft = monthsLeft * 30 + (o.dueDay - currentDay);
        }
      } else if (o.frequency === "one_time" && o.dueDate) {
        // حساب الأيام المتبقية للالتزام لمرة واحدة
        const dueDate = new Date(o.dueDate * 1000);
        const diffTime = dueDate.getTime() - now.getTime();
        daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }
      
      return { ...o, daysLeft };
    })
    .filter((o): o is UpcomingObligation => o.daysLeft >= 0) // فقط الالتزامات المستقبلية
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, limit);
  
  return obligationsWithDaysLeft;
}

// Helper: تنسيق موعد الاستحقاق للعرض
function formatObligationDueDate(obligation: Obligation): string {
  if (obligation.frequency === "monthly" && obligation.dueDay) {
    return `${obligation.dueDay} من الشهر`;
  }
  if (obligation.frequency === "yearly" && obligation.dueMonth && obligation.dueDay) {
    const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    return `${obligation.dueDay} ${months[obligation.dueMonth - 1]}`;
  }
  if (obligation.frequency === "one_time" && obligation.dueDate) {
    return new Date(obligation.dueDate * 1000).toLocaleDateString("ar-OM", {
      day: "numeric",
      month: "short",
    });
  }
  return "غير محدد";
}

export default function Dashboard() {
  const [showBalance, setShowBalance] = useState(true);
  const { data: user } = useUser();
  const { data: dashboard, isLoading } = useDashboard();
  const { data: obligations, isLoading: isLoadingObligations } = useObligations();
  
  const upcomingObligations = getUpcomingObligations(obligations, 5);

  return (
    <div className="flex flex-col gap-6 p-4 pt-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex justify-between items-center mb-2">
        <div>
          <h1 className="text-sm font-medium text-muted-foreground" data-testid="text-greeting">مرحباً بعودتك،</h1>
          <h2 className="text-xl font-bold" data-testid="text-username">{user?.name || "المستخدم"}</h2>
        </div>
        <Link href="/settings">
          <div className="h-11 w-11 bg-primary/10 rounded-full flex items-center justify-center text-primary cursor-pointer hover:bg-primary/20 transition-colors" data-testid="link-settings">
            <Settings className="h-5 w-5" />
          </div>
        </Link>
      </header>

      <Card className="border-none shadow-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground overflow-hidden relative">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-3xl -mr-10 -mt-10"></div>
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-black/10 rounded-full blur-2xl -ml-5 -mb-5"></div>
        
        <CardContent className="p-6 relative z-10">
          <div className="flex justify-between items-start mb-6">
            <span className="text-primary-foreground/80 font-medium">الرصيد الإجمالي</span>
            <button 
              onClick={() => setShowBalance(!showBalance)}
              className="text-primary-foreground/80 hover:text-white transition-colors"
              data-testid="button-toggle-balance"
            >
              {showBalance ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
            </button>
          </div>
          
          <div className="mb-8">
            <h3 className="text-4xl font-black tracking-tight flex items-baseline gap-2" data-testid="text-total-balance">
              {isLoading ? (
                <Loader2 className="h-8 w-8 animate-spin" />
              ) : showBalance ? (
                <>
                  <span>{(dashboard?.totalBalance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span className="text-lg font-medium text-primary-foreground/80">ر.ع</span>
                </>
              ) : (
                "••••••••"
              )}
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/20">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 p-2 rounded-xl">
                <ArrowDownLeft className="h-5 w-5 text-green-300" strokeWidth={3} />
              </div>
              <div>
                <p className="text-xs text-primary-foreground/70 mb-0.5">الدخل</p>
                <p className="font-semibold" data-testid="text-income">
                  {showBalance ? `+${(dashboard?.totalIncome ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : "••••"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="bg-white/20 p-2 rounded-xl">
                <ArrowUpRight className="h-5 w-5 text-red-300" strokeWidth={3} />
              </div>
              <div>
                <p className="text-xs text-primary-foreground/70 mb-0.5">المصروفات</p>
                <p className="font-semibold" data-testid="text-expenses">
                  {showBalance ? `-${(dashboard?.totalExpenses ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : "••••"}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-lg">الالتزامات القادمة</h3>
          <Link href="/obligations">
            <Button variant="link" className="text-primary h-auto p-0 cursor-pointer">عرض الكل</Button>
          </Link>
        </div>

        {isLoadingObligations ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : upcomingObligations.length > 0 ? (
          <Card className="border border-border/50 shadow-sm">
            <CardContent className="p-4">
              <div className="space-y-3">
                {upcomingObligations.map((obligation) => (
                  <div 
                    key={obligation.id} 
                    className="flex items-center justify-between p-3 bg-muted/30 rounded-xl hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                        <Receipt className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm">{obligation.title}</h4>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <Calendar className="h-3 w-3" />
                          <span>{formatObligationDueDate(obligation)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-left">
                      <span className="font-bold text-destructive text-sm">
                        {obligation.amount.toLocaleString('ar-OM', { minimumFractionDigits: 3 })} ر.ع
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="text-center py-8 bg-muted/20 rounded-2xl border border-dashed border-border/50">
            <Receipt className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground text-sm">لا توجد التزامات قادمة</p>
            <p className="text-xs text-muted-foreground/70 mt-1">أضف التزاماتك المالية لتتبع مواعيد الاستحقاق</p>
          </div>
        )}
      </div>

      <div className="mt-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-lg">أحدث المعاملات</h3>
          <Link href="/transactions">
            <Button variant="link" className="text-primary h-auto p-0 cursor-pointer" data-testid="link-all-transactions">عرض الكل</Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : dashboard?.recentTransactions && dashboard.recentTransactions.length > 0 ? (
          <div className="flex flex-col gap-3">
            {dashboard.recentTransactions.map((tx) => {
              const catName = tx.categoryName || "أخرى";
              const colors = categoryColors[catName] || { icon: tx.categoryIcon || "📝", bg: "bg-muted" };
              return (
                <div key={tx.id} className="bg-card p-4 rounded-2xl border border-border/50 shadow-sm flex items-center justify-between hover-elevate transition-all cursor-pointer" data-testid={`card-transaction-${tx.id}`}>
                  <div className="flex items-center gap-4">
                    <div className={cn("h-12 w-12 rounded-2xl flex items-center justify-center text-xl", colors.bg)}>
                      {tx.categoryIcon || colors.icon}
                    </div>
                    <div>
                      <h4 className="font-bold">{catName}</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">{tx.note} {tx.date && `• ${formatDate(tx.date)}`}</p>
                    </div>
                  </div>
                  <div className={cn(
                    "font-bold text-lg",
                    tx.type === 'income' ? "text-emerald-500" : tx.type === 'expense' ? "text-red-500" : ""
                  )}>
                    {tx.type === 'income' ? '+' : '-'}{tx.amount.toFixed(2)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-10 bg-muted/20 rounded-2xl border border-dashed border-border/50">
            <p className="text-muted-foreground font-medium">لا توجد معاملات بعد</p>
            <p className="text-xs text-muted-foreground/70 mt-1">أضف معاملتك الأولى بالضغط على زر + أسفل الشاشة</p>
          </div>
        )}
      </div>
    </div>
  );
}
