import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { CalendarDays, CheckCircle2, CircleAlert, ClipboardList, Clock3, Inbox, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useManagedCommitmentShares } from "@/lib/hooks";

const statusLabels: Record<string, string> = {
  pending: "بانتظار الرد",
  accepted: "قيد التنفيذ",
  declined: "اعتذر عنها",
  completed: "بانتظار اعتمادك",
  approved: "تم الاعتماد",
  revoked: "تم الإلغاء",
};

const typeLabels: Record<string, string> = {
  financial: "مالي",
  government: "حكومي",
  home: "المنزل",
  vehicle: "المركبة",
  health: "الصحة",
  family: "الأسرة",
  work: "العمل",
  personal: "شخصي",
};

function formatDate(timestamp: number | null) {
  if (!timestamp) return "بدون موعد";
  return new Intl.DateTimeFormat("ar-OM", { day: "numeric", month: "short", year: "numeric" }).format(new Date(timestamp * 1000));
}

type ViewFilter = "all" | "attention" | "active" | "done";

export default function ManagedCommitments() {
  const [, setLocation] = useLocation();
  const { data: shares = [], isLoading } = useManagedCommitmentShares();
  const [filter, setFilter] = useState<ViewFilter>("all");
  const startOfToday = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.floor(now.getTime() / 1000);
  }, []);

  const isOverdue = (share: (typeof shares)[number]) =>
    !!share.dueDate && share.dueDate < startOfToday && (share.status === "pending" || share.status === "accepted");

  const counts = useMemo(() => ({
    overdue: shares.filter(isOverdue).length,
    review: shares.filter((share) => share.status === "completed").length,
    active: shares.filter((share) => share.status === "pending" || share.status === "accepted").length,
    approved: shares.filter((share) => share.status === "approved").length,
  }), [shares, startOfToday]);

  const visibleShares = useMemo(() => shares.filter((share) => {
    if (filter === "attention") return isOverdue(share) || share.status === "completed" || share.status === "declined";
    if (filter === "active") return share.status === "pending" || share.status === "accepted";
    if (filter === "done") return share.status === "approved" || share.status === "revoked";
    return true;
  }), [filter, shares, startOfToday]);

  return (
    <div className="space-y-5 py-4" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">متابعة ما أسندته</h1>
          <p className="mt-1 text-sm text-muted-foreground">اعرف ما تأخر، وما ينتظر اعتمادك، وما تم إنجازه.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setLocation("/shared-commitments")}><Inbox className="h-4 w-4" />المهام الواردة</Button>
          <Button type="button" onClick={() => setLocation("/commitments")}><ClipboardList className="h-4 w-4" />التزاماتي</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="border-red-200 bg-red-50/50"><CardContent className="p-4"><CircleAlert className="mb-2 h-5 w-5 text-red-600" /><p className="text-2xl font-bold">{counts.overdue}</p><p className="text-xs text-muted-foreground">متأخرة</p></CardContent></Card>
        <Card className="border-amber-200 bg-amber-50/50"><CardContent className="p-4"><Clock3 className="mb-2 h-5 w-5 text-amber-600" /><p className="text-2xl font-bold">{counts.review}</p><p className="text-xs text-muted-foreground">تنتظر اعتمادك</p></CardContent></Card>
        <Card><CardContent className="p-4"><UserRound className="mb-2 h-5 w-5 text-primary" /><p className="text-2xl font-bold">{counts.active}</p><p className="text-xs text-muted-foreground">قيد المتابعة</p></CardContent></Card>
        <Card className="border-emerald-200 bg-emerald-50/50"><CardContent className="p-4"><CheckCircle2 className="mb-2 h-5 w-5 text-emerald-600" /><p className="text-2xl font-bold">{counts.approved}</p><p className="text-xs text-muted-foreground">تم اعتمادها</p></CardContent></Card>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {([
          ["all", "الكل"],
          ["attention", "تحتاج انتباهي"],
          ["active", "قيد التنفيذ"],
          ["done", "المكتملة"],
        ] as const).map(([value, label]) => (
          <Button key={value} type="button" size="sm" variant={filter === value ? "default" : "outline"} className="shrink-0" onClick={() => setFilter(value)}>{label}</Button>
        ))}
      </div>

      {isLoading ? <p className="py-12 text-center text-sm text-muted-foreground">جاري تحميل المتابعة...</p> : visibleShares.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><ClipboardList className="mx-auto mb-3 h-9 w-9 text-muted-foreground" /><p className="font-medium">لا توجد مهام هنا الآن</p><p className="mt-1 text-sm text-muted-foreground">يمكنك إسناد أي التزام من صفحة تفاصيله.</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {visibleShares.map((share) => {
            const overdue = isOverdue(share);
            return (
              <Card key={share.id} className={share.status === "completed" ? "border-amber-200" : overdue ? "border-red-200" : share.status === "approved" ? "border-emerald-200" : ""}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-muted px-2 py-1">{typeLabels[share.type] || "عام"}</span>
                        <span className={"rounded-full px-2 py-1 " + (share.status === "completed" ? "bg-amber-100 text-amber-800" : overdue ? "bg-red-100 text-red-700" : share.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground")}>{overdue ? "متأخرة" : statusLabels[share.status]}</span>
                      </div>
                      <h2 className="font-bold">{share.title}</h2>
                      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><UserRound className="h-4 w-4" />{share.assigneeName}</span>
                        <span className="inline-flex items-center gap-1"><CalendarDays className="h-4 w-4" />{formatDate(share.dueDate)}</span>
                        {share.dueTime ? <span className="inline-flex items-center gap-1"><Clock3 className="h-4 w-4" />{share.dueTime}</span> : null}
                      </p>
                      {share.status === "completed" ? <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">أنهى المكلّف المهمة. افتحها لمراجعة النتيجة واعتمادها.</p> : null}
                      {share.status === "declined" ? <p className="mt-3 rounded-lg bg-muted p-2 text-xs">اعتذر الشخص عن تنفيذ المهمة. يمكنك إسنادها لشخص آخر.</p> : null}
                    </div>
                    <Button type="button" size="sm" variant={share.status === "completed" ? "default" : "outline"} onClick={() => setLocation(`/commitments/${share.commitmentId}`)}>
                      {share.status === "completed" ? "مراجعة" : "فتح"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
