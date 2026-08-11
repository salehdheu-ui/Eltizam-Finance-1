import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { apiRequest } from "@/lib/queryClient";
import { AlertTriangle, CalendarDays, Loader2, Repeat, ShieldAlert, Sparkles, TrendingDown, TrendingUp } from "lucide-react";

type Insights = {
  risks: Array<{ severity: "high" | "medium" | "low"; title: string; detail: string }>;
  recurring: Array<{ label: string; averageAmount: number; occurrences: number; averageGapDays: number; suggestedFrequency: string; lastSeen: number }>;
  weekly: {
    spent: number; received: number; net: number; transactionCount: number;
    changeVsPriorWeek: number | null;
    topSpend: Array<{ label: string; total: number }>;
    dueNext7Days: Array<{ title: string; dueDate: number; amount: number | null; overdue: boolean }>;
    dueTotal: number;
  };
};

type Simulation = {
  verdict: "comfortable" | "tight" | "unaffordable";
  advice: string;
  freeBefore: number; freeAfter: number; totalCost: number;
  projectedBalance: number; commitmentRatio: number;
};

const SEVERITY_STYLES = {
  high: "border-red-200 bg-red-50 text-red-900",
  medium: "border-amber-200 bg-amber-50 text-amber-900",
  low: "border-slate-200 bg-slate-50 text-slate-800",
} as const;

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: "أسبوعي", monthly: "شهري", yearly: "سنوي",
};

const VERDICT_STYLES = {
  comfortable: { label: "مريح", className: "bg-emerald-50 border-emerald-200 text-emerald-900" },
  tight: { label: "على الحافة", className: "bg-amber-50 border-amber-200 text-amber-900" },
  unaffordable: { label: "فوق طاقتك", className: "bg-red-50 border-red-200 text-red-900" },
} as const;

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("ar-OM", { dateStyle: "medium" }).format(new Date(timestamp * 1000));
}

export default function InsightsPanel() {
  const { data, isLoading } = useQuery<Insights>({ queryKey: ["/api/insights"] });
  const [cost, setCost] = useState("");
  const [months, setMonths] = useState("12");
  const [simulation, setSimulation] = useState<Simulation | null>(null);

  const simulate = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/insights/simulate", {
        newMonthlyCost: Number(cost),
        months: Number(months) || 12,
      });
      return response.json() as Promise<Simulation>;
    },
    onSuccess: setSimulation,
  });

  if (isLoading || !data) {
    return <Card className="p-4"><div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div></Card>;
  }

  const { weekly } = data;

  return (
    <div className="space-y-4">
      {data.risks.length > 0 ? (
        <Card className="p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 text-red-700"><ShieldAlert className="h-5 w-5" /></div>
            <div>
              <h2 className="font-bold">ما يستحق انتباهك</h2>
              <p className="text-sm text-muted-foreground">محسوب من حركاتك والتزاماتك.</p>
            </div>
          </div>
          <div className="space-y-2">
            {data.risks.map((risk) => (
              <div key={risk.title} className={`rounded-xl border p-3 ${SEVERITY_STYLES[risk.severity]}`}>
                <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 shrink-0" />{risk.title}</p>
                <p className="mt-1 text-sm leading-6">{risk.detail}</p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700"><CalendarDays className="h-5 w-5" /></div>
          <div>
            <h2 className="font-bold">أسبوعك</h2>
            <p className="text-sm text-muted-foreground">{weekly.transactionCount} حركة خلال 7 أيام.</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-red-50 p-3">
            <p className="text-xs text-red-800">صرفت</p>
            <p className="mt-1 font-bold text-red-700"><CurrencyDisplay amount={weekly.spent} fractionDigits={3} /></p>
            {weekly.changeVsPriorWeek !== null ? (
              <p className="mt-1 flex items-center gap-1 text-xs text-red-800">
                {weekly.changeVsPriorWeek >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {Math.abs(weekly.changeVsPriorWeek)}% عن الأسبوع الماضي
              </p>
            ) : null}
          </div>
          <div className="rounded-xl bg-emerald-50 p-3">
            <p className="text-xs text-emerald-800">دخلك</p>
            <p className="mt-1 font-bold text-emerald-700"><CurrencyDisplay amount={weekly.received} fractionDigits={3} /></p>
          </div>
          <div className="rounded-xl bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">الصافي</p>
            <p className={`mt-1 font-bold ${weekly.net >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              <CurrencyDisplay amount={weekly.net} fractionDigits={3} />
            </p>
          </div>
        </div>

        {weekly.topSpend.length > 0 ? (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-semibold">أكثر ما صرفت عليه</p>
            {weekly.topSpend.map((entry) => (
              <div key={entry.label} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
                <span className="truncate">{entry.label}</span>
                <CurrencyDisplay amount={entry.total} fractionDigits={3} />
              </div>
            ))}
          </div>
        ) : null}

        {weekly.dueNext7Days.length > 0 ? (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-semibold">
              مستحق خلال الأسبوع — <CurrencyDisplay amount={weekly.dueTotal} fractionDigits={3} />
            </p>
            {weekly.dueNext7Days.map((item) => (
              <div key={`${item.title}-${item.dueDate}`} className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${item.overdue ? "bg-red-50 text-red-800" : "bg-muted/40"}`}>
                <span className="truncate">{item.title}{item.overdue ? " · متأخر" : ""}</span>
                <span className="shrink-0 text-xs">{formatDate(item.dueDate)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      {data.recurring.length > 0 ? (
        <Card className="p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Repeat className="h-5 w-5" /></div>
            <div>
              <h2 className="font-bold">مصاريف تتكرر عليك</h2>
              <p className="text-sm text-muted-foreground">اكتشفناها من نمط حركاتك — لم تسجّلها كالتزامات.</p>
            </div>
          </div>
          <div className="space-y-2">
            {data.recurring.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-3 rounded-xl border p-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{item.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {FREQUENCY_LABELS[item.suggestedFrequency] || item.suggestedFrequency} تقريباً · {item.occurrences} مرات · كل {item.averageGapDays} يوماً
                  </p>
                </div>
                <span className="shrink-0 font-bold"><CurrencyDisplay amount={item.averageAmount} fractionDigits={3} /></span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><Sparkles className="h-5 w-5" /></div>
          <div>
            <h2 className="font-bold">هل أقدر عليه؟</h2>
            <p className="text-sm text-muted-foreground">جرّب التزاماً جديداً قبل أن تلتزم به.</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="sim-cost">التكلفة الشهرية</Label>
            <Input id="sim-cost" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="150" inputMode="decimal" dir="ltr" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sim-months">لمدة (شهر)</Label>
            <Input id="sim-months" value={months} onChange={(event) => setMonths(event.target.value)} inputMode="numeric" dir="ltr" />
          </div>
        </div>

        <Button
          className="mt-3 w-full"
          onClick={() => simulate.mutate()}
          disabled={!Number(cost) || simulate.isPending}
        >
          {simulate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "احسب"}
        </Button>

        {simulation ? (
          <div className={`mt-3 rounded-xl border p-3 ${VERDICT_STYLES[simulation.verdict].className}`}>
            <p className="font-bold">{VERDICT_STYLES[simulation.verdict].label}</p>
            <p className="mt-1 text-sm leading-6">{simulation.advice}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>المتبقي شهرياً قبل: <CurrencyDisplay amount={simulation.freeBefore} fractionDigits={3} /></div>
              <div>وبعد: <CurrencyDisplay amount={simulation.freeAfter} fractionDigits={3} /></div>
              <div>التكلفة الكلية: <CurrencyDisplay amount={simulation.totalCost} fractionDigits={3} /></div>
              <div>الالتزامات ستأخذ {simulation.commitmentRatio}% من دخلك</div>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
