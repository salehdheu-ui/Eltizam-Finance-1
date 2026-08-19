import { useState } from "react";
import { useLocation } from "wouter";
import { CalendarDays, Check, Circle, CircleCheck, Handshake, ListChecks, Loader2, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompleteSharedCommitment, useRespondToCommitmentShare, useSharedCommitments, useToggleSharedCommitmentStep } from "@/lib/hooks";

function formatDate(timestamp: number | null) {
  if (!timestamp) return "بدون موعد";
  return new Intl.DateTimeFormat("ar-OM", { day: "numeric", month: "long", year: "numeric" }).format(new Date(timestamp * 1000));
}

const statusLabels = {
  pending: "بانتظار موافقتك",
  accepted: "قيد التنفيذ",
  completed: "بانتظار اعتماد المالك",
  approved: "اعتمد المالك الإنجاز",
} as const;

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

export default function SharedCommitments() {
  const [, setLocation] = useLocation();
  const { data: shares = [], isLoading } = useSharedCommitments();
  const respond = useRespondToCommitmentShare();
  const complete = useCompleteSharedCommitment();
  const toggleStep = useToggleSharedCommitmentStep();
  const [completionNotes, setCompletionNotes] = useState<Record<number, string>>({});

  return (
    <div className="space-y-5 py-4" dir="rtl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Handshake className="h-6 w-6 text-primary" />مهام مُسندة إليّ</h1>
          <p className="mt-1 text-sm text-muted-foreground">المهام التي شاركها الآخرون معك. خصوصيتهم محفوظة؛ لا تظهر هنا أموالهم أو ملاحظاتهم الخاصة.</p>
        </div>
        <Button variant="outline" onClick={() => setLocation("/commitments")}>التزاماتي</Button>
      </header>

      {!isLoading && shares.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          <Card><CardContent className="p-3 text-center"><p className="text-xl font-bold">{shares.filter((share) => share.status === "pending").length}</p><p className="text-xs text-muted-foreground">بانتظار الرد</p></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><p className="text-xl font-bold">{shares.filter((share) => share.status === "accepted" || share.status === "completed").length}</p><p className="text-xs text-muted-foreground">تحت التنفيذ</p></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><p className="text-xl font-bold text-emerald-700">{shares.filter((share) => share.status === "approved").length}</p><p className="text-xs text-muted-foreground">معتمدة</p></CardContent></Card>
        </div>
      ) : null}

      {isLoading ? (
        <Card><CardContent className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>
      ) : shares.length === 0 ? (
        <Card className="border-dashed bg-muted/20"><CardContent className="py-12 text-center"><Handshake className="mx-auto h-10 w-10 text-primary/60" /><h2 className="mt-3 font-bold">لا توجد مهام مشتركة</h2><p className="mt-1 text-sm text-muted-foreground">عند إسناد مهمة لك من مستخدم آخر، ستظهر هنا.</p></CardContent></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {shares.map((share) => {
            const note = completionNotes[share.id] ?? "";
            const isPending = share.status === "pending";
            const isAccepted = share.status === "accepted";
            const isCompleted = share.status === "completed";
            const isApproved = share.status === "approved";
            const completedSteps = share.steps.filter((step) => step.isCompleted).length;
            return (
              <Card key={share.id} className={isApproved ? "border-emerald-200 bg-emerald-50/40" : isCompleted ? "border-amber-200 bg-amber-50/40" : "border-border/70"}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">{statusLabels[share.status]}</span>
                        <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">{typeLabels[share.type] || "عام"}</span>
                      </div>
                      <h2 className={"text-lg font-bold " + (isApproved ? "text-muted-foreground line-through" : "")}>{share.title}</h2>
                    </div>
                    {isApproved ? <CircleCheck className="h-6 w-6 shrink-0 text-emerald-600" /> : <UserRound className="h-6 w-6 shrink-0 text-primary" />}
                  </div>

                  <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                    <p className="flex items-center gap-2"><UserRound className="h-4 w-4" />من: {share.ownerName}</p>
                    <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4" />الموعد: {formatDate(share.dueDate)}</p>
                    {(isCompleted || isApproved) && share.completionNote ? <p className="rounded-xl bg-background/70 p-3 text-foreground">ملاحظتك: {share.completionNote}</p> : null}
                    {isAccepted && share.reviewNote ? <p className="rounded-xl bg-amber-50 p-3 text-amber-800">طلب المالك تعديلًا: {share.reviewNote}</p> : null}
                  </div>

                  {share.steps.length > 0 ? (
                    <div className="mt-5 overflow-hidden rounded-xl border bg-background/70">
                      <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2.5">
                        <p className="flex items-center gap-2 text-sm font-semibold"><ListChecks className="h-4 w-4 text-primary" />خطوات التنفيذ</p>
                        <span className="text-xs text-muted-foreground">{completedSteps} من {share.steps.length} · {share.progress}%</span>
                      </div>
                      <div className="divide-y">
                        {share.steps.map((step) => (
                          <div key={step.id} className="flex items-center gap-3 p-3">
                            <button
                              type="button"
                              aria-label={step.isCompleted ? "إعادة فتح الخطوة" : "إكمال الخطوة"}
                              title={isAccepted ? undefined : "اقبل المهمة أولاً"}
                              disabled={!isAccepted || toggleStep.isPending}
                              onClick={() => toggleStep.mutate({ shareId: share.id, stepId: step.id })}
                              className="text-primary disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              {step.isCompleted ? <Check className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                            </button>
                            <span className={"min-w-0 flex-1 text-sm " + (step.isCompleted ? "text-muted-foreground line-through" : "")}>{step.title}</span>
                          </div>
                        ))}
                      </div>
                      {isPending ? <p className="border-t bg-primary/5 px-3 py-2 text-xs text-primary">اقبل المهمة لتتمكن من تحديث خطوات التنفيذ.</p> : null}
                    </div>
                  ) : null}

                  {isPending ? (
                    <div className="mt-5 grid grid-cols-2 gap-2">
                      <Button disabled={respond.isPending} onClick={() => respond.mutate({ id: share.id, status: "accepted" })}><Check className="h-4 w-4" />قبول المهمة</Button>
                      <Button variant="outline" disabled={respond.isPending} onClick={() => respond.mutate({ id: share.id, status: "declined" })}><X className="h-4 w-4" />اعتذار</Button>
                    </div>
                  ) : null}

                  {isAccepted ? (
                    <div className="mt-5 space-y-2 rounded-xl border bg-muted/20 p-3">
                      <Label htmlFor={`completion-note-${share.id}`} className="text-sm">ملاحظة إنجاز اختيارية</Label>
                      <Input id={`completion-note-${share.id}`} value={note} onChange={(event) => setCompletionNotes((current) => ({ ...current, [share.id]: event.target.value }))} maxLength={500} placeholder="مثال: تم التسليم إلى أحمد" />
                      <Button className="w-full" disabled={complete.isPending} onClick={() => complete.mutate({ id: share.id, completionNote: note.trim() || undefined })}><CircleCheck className="h-4 w-4" />تأكيد الإنجاز</Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
