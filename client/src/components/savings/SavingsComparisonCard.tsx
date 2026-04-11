import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { cn } from "@/lib/utils";

export type SavingsComparisonItem = {
  key: string;
  label: string;
  currentRate: number;
  targetRate: number;
  currentAmount: number;
  targetAmount: number;
  accentClassName: string;
};

type SavingsComparisonCardProps = {
  items: SavingsComparisonItem[];
};

export function SavingsComparisonCard({ items }: SavingsComparisonCardProps) {
  return (
    <Card dir="rtl" className="text-right">
      <CardHeader className="pb-3">
        <CardTitle className="text-base sm:text-lg text-center sm:text-right">مقارنة وضعك الحالي بالخطة المقترحة</CardTitle>
      </CardHeader>
      <CardContent className="text-right">
        <div className="flex flex-col gap-1 text-center sm:flex-row-reverse sm:items-center sm:justify-between sm:text-right">
          <p className="font-medium text-foreground">حتى تعرف أين تحتاج التعديل تحديداً</p>
          <p className="text-xs text-muted-foreground">الحالي مقابل المستهدف لكل بند</p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {items.map((item) => {
            const rateDifference = item.targetRate - item.currentRate;
            const amountDifference = item.targetAmount - item.currentAmount;

            return (
              <div key={item.key} className="rounded-xl border bg-slate-50 p-4">
                <div className="flex flex-col gap-2 text-center sm:flex-row sm:items-center sm:justify-between sm:text-right">
                  <p className={cn("font-bold", item.accentClassName)}>{item.label}</p>
                  <span className="text-xs text-muted-foreground">
                    الآن {Math.round(item.currentRate * 100)}% / المستهدف {Math.round(item.targetRate * 100)}%
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div className={cn("h-full rounded-full", item.accentClassName.replace("text", "bg"))} style={{ width: `${Math.min(Math.max(item.currentRate * 100, 0), 100)}%` }} />
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className={cn("h-full rounded-full opacity-70", item.accentClassName.replace("text", "bg"))} style={{ width: `${Math.min(Math.max(item.targetRate * 100, 0), 100)}%` }} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-sm text-right">
                  <span className="text-muted-foreground">الوضع الحالي</span>
                  <span className="font-medium"><CurrencyDisplay amount={item.currentAmount} fractionDigits={2} /></span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 text-sm text-right">
                  <span className="text-muted-foreground">المستهدف</span>
                  <span className="font-medium"><CurrencyDisplay amount={item.targetAmount} fractionDigits={2} /></span>
                </div>
                <p className={cn("mt-3 text-sm font-medium", rateDifference > 0 ? "text-amber-700" : rateDifference < 0 ? "text-sky-700" : "text-emerald-700")}>
                  {amountDifference > 0
                    ? `تحتاج زيادة ${amountDifference.toFixed(2)}`
                    : amountDifference < 0
                      ? `يمكنك خفض ${Math.abs(amountDifference).toFixed(2)}`
                      : "أنت قريب جداً من النسبة المقترحة"}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
