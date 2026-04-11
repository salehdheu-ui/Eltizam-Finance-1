import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { cn } from "@/lib/utils";

type StatusTone = {
  title: string;
  description: string;
  className: string;
  badgeClassName: string;
};

type SavingsStatusCardProps = {
  statusTone: StatusTone;
  effectiveIncome: number;
  currentSavingsRate: number;
  currentSavings: number;
  targetSavingsAmount: number;
  improvementGap: number;
};

export function SavingsStatusCard({
  statusTone,
  effectiveIncome,
  currentSavingsRate,
  currentSavings,
  targetSavingsAmount,
  improvementGap,
}: SavingsStatusCardProps) {
  return (
    <Card className={cn("border text-right", statusTone.className)} dir="rtl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base sm:text-lg flex flex-col items-center justify-center gap-3 text-center sm:flex-row-reverse sm:justify-between sm:text-right">
          <span>{statusTone.title}</span>
          <span className={cn("rounded-full px-3 py-1 text-xs font-bold", statusTone.badgeClassName)}>
            {effectiveIncome > 0 ? `${Math.round(currentSavingsRate * 100)}% ادخار` : "بيانات محدودة"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-right">
        <p>{statusTone.description}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">الفائض الشهري الحالي</p>
            <p className={cn("mt-1 font-bold", currentSavings >= 0 ? "text-emerald-700" : "text-red-700")}>
              <CurrencyDisplay amount={currentSavings} fractionDigits={2} />
            </p>
          </div>
          <div className="rounded-xl border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">المطلوب للخطة الموصى بها</p>
            <p className="mt-1 font-bold text-foreground">
              <CurrencyDisplay amount={targetSavingsAmount} fractionDigits={2} />
            </p>
          </div>
          <div className="rounded-xl border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">فجوة التحسين</p>
            <p className="mt-1 font-bold text-amber-700">
              <CurrencyDisplay amount={improvementGap} fractionDigits={2} />
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
