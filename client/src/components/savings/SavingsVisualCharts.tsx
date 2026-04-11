import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { Target, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type ComparisonChartDatum = {
  name: string;
  current: number;
  target: number;
  color: string;
};

type ProjectionChartDatum = {
  years: string;
  balance: number;
  isActive: boolean;
};

type SavingsVisualChartsProps = {
  comparisonChartData: ComparisonChartDatum[];
  projectionChartData: ProjectionChartDatum[];
};

export function SavingsVisualCharts({ comparisonChartData, projectionChartData }: SavingsVisualChartsProps) {
  return (
    <>
      <Card dir="rtl" className="text-right">
        <CardHeader className="pb-3">
          <CardTitle className="text-base sm:text-lg flex flex-row-reverse items-center justify-center gap-2 text-center sm:justify-start sm:text-right">
            <TrendingUp className="h-5 w-5 text-primary" />
            عرض بصري للوضع الحالي مقابل المستهدف
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-right">
          <div className="h-80 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonChartData} barGap={8}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip formatter={(value: number) => formatCurrency(Number(value), 2)} />
                <Bar dataKey="current" name="الحالي" radius={[8, 8, 0, 0]} fill="#94a3b8" />
                <Bar dataKey="target" name="المستهدف" radius={[8, 8, 0, 0]}>
                  {comparisonChartData.map((entry, index) => (
                    <Cell key={`${entry.name}-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-3 text-center">الرمادي: الوضع الحالي</div>
            <div className="rounded-lg bg-blue-50 p-3 text-center text-blue-700">الأزرق: الاحتياجات المستهدفة</div>
            <div className="rounded-lg bg-amber-50 p-3 text-center text-amber-700">البرتقالي: الرغبات المستهدفة</div>
            <div className="rounded-lg bg-emerald-50 p-3 text-center text-emerald-700">الأخضر/البنفسجي: الادخار والاحتياطي</div>
          </div>
        </CardContent>
      </Card>

      <Card dir="rtl" className="text-right">
        <CardHeader className="pb-3">
          <CardTitle className="text-base sm:text-lg flex flex-row-reverse items-center justify-center gap-2 text-center sm:justify-start sm:text-right">
            <Target className="h-5 w-5 text-primary" />
            كيف تنمو الخطة الموصى بها عبر الزمن؟
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-right">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {projectionChartData.map((item) => (
              <div key={item.years} className={item.isActive ? "rounded-xl border border-primary bg-primary/5 p-3" : "rounded-xl border bg-white p-3"}>
                <p className="text-xs text-muted-foreground">{item.years}</p>
                <p className="mt-1 font-bold text-foreground">{formatCurrency(item.balance, 2)}</p>
              </div>
            ))}
          </div>
          <div className="h-72 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={projectionChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="years" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip formatter={(value: number) => formatCurrency(Number(value), 2)} />
                <Bar dataKey="balance" name="الرصيد المتوقع" radius={[8, 8, 0, 0]}>
                  {projectionChartData.map((entry, index) => (
                    <Cell key={`${entry.years}-${index}`} fill={entry.isActive ? "#059669" : "#93c5fd"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted-foreground">
            هذا العرض يوضح الرصيد المتوقع للخطة الموصى بها عبر ثلاث مدد زمنية، مع تمييز المدة المختارة حالياً.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
