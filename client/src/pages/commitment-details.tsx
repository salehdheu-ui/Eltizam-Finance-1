import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  ArrowRight,
  BellRing,
  CalendarDays,
  Check,
  Circle,
  CircleCheck,
  FileCheck2,
  Link2,
  Plus,
  Receipt,
  RotateCcw,
  Save,
  ShieldAlert,
  Trash2,
  UserRoundPlus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  useCommitment,
  useCommitmentProofs,
  useCommitmentSteps,
  useCreateCommitmentProof,
  useCreateCommitmentStep,
  useDeleteCommitmentProof,
  useDeleteCommitmentStep,
  useCommitmentShares,
  useCreateCommitmentShare,
  useRevokeCommitmentShare,
  useReviewCommitmentShare,
  useSharedCommitmentPeople,
  useToggleCommitmentStep,
  useUpdateCommitment,
  useUpdateCommitmentStatus,
} from "@/lib/hooks";

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

const frequencyLabels: Record<string, string> = {
  one_time: "مرة واحدة",
  daily: "يومياً",
  weekly: "أسبوعياً",
  monthly: "شهرياً",
  yearly: "سنوياً",
};

function formatDate(timestamp: number | null) {
  if (!timestamp) return "بدون موعد";
  return new Intl.DateTimeFormat("ar-OM", { day: "numeric", month: "long", year: "numeric" }).format(new Date(timestamp * 1000));
}

export default function CommitmentDetails() {
  const params = useParams<{ id: string }>();
  const commitmentId = Number(params.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: commitment, isLoading } = useCommitment(commitmentId);
  const { data: steps = [] } = useCommitmentSteps(commitmentId);
  const { data: proofs = [] } = useCommitmentProofs(commitmentId);
  const { data: shares = [] } = useCommitmentShares(commitmentId);
  const { data: sharedPeople = [] } = useSharedCommitmentPeople();
  const createStep = useCreateCommitmentStep(commitmentId);
  const toggleStep = useToggleCommitmentStep(commitmentId);
  const deleteStep = useDeleteCommitmentStep(commitmentId);
  const createProof = useCreateCommitmentProof(commitmentId);
  const deleteProof = useDeleteCommitmentProof(commitmentId);
  const updateStatus = useUpdateCommitmentStatus();
  const createShare = useCreateCommitmentShare(commitmentId);
  const revokeShare = useRevokeCommitmentShare(commitmentId);
  const reviewShare = useReviewCommitmentShare(commitmentId);
  const updateCommitment = useUpdateCommitment();
  const [stepTitle, setStepTitle] = useState("");
  const [proofLabel, setProofLabel] = useState("");
  const [proofValue, setProofValue] = useState("");
  const [proofKind, setProofKind] = useState<"note" | "link" | "receipt">("note");
  const [assigneeEmail, setAssigneeEmail] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [reminderDaysBefore, setReminderDaysBefore] = useState(3);
  const [escalateAfterDays, setEscalateAfterDays] = useState<number | null>(null);
  const [autoCloseOnProof, setAutoCloseOnProof] = useState(true);

  useEffect(() => {
    if (!commitment) return;
    setReminderDaysBefore(commitment.reminderDaysBefore);
    setEscalateAfterDays(commitment.escalateAfterDays);
    setAutoCloseOnProof(commitment.autoCloseOnProof);
  }, [commitment]);

  const completedSteps = useMemo(() => steps.filter((step) => step.isCompleted).length, [steps]);
  const progress = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0;
  const availablePeople = useMemo(() => {
    const assignedEmails = new Set(shares.map((share) => share.assigneeEmail.toLowerCase()));
    return sharedPeople.filter((person) => !assignedEmails.has(person.email.toLowerCase())).slice(0, 6);
  }, [sharedPeople, shares]);

  const handleAddStep = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stepTitle.trim()) return;
    await createStep.mutateAsync({ title: stepTitle.trim() });
    setStepTitle("");
  };

  const handleAddProof = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!proofLabel.trim() || !proofValue.trim()) return;
    await createProof.mutateAsync({
      kind: proofKind,
      label: proofLabel.trim(),
      value: proofValue.trim(),
    });
    setProofLabel("");
    setProofValue("");
  };

  const handleShare = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!assigneeEmail.trim()) return;
    await createShare.mutateAsync(assigneeEmail.trim());
    setAssigneeEmail("");
  };

  const handleSaveAutomation = async () => {
    try {
      await updateCommitment.mutateAsync({ id: commitmentId, reminderDaysBefore, escalateAfterDays, autoCloseOnProof });
      toast({ title: "تم حفظ الأتمتة", description: "سيطبق النظام هذه القواعد تلقائيًا على الالتزام." });
    } catch (error) {
      toast({ title: "تعذر حفظ الأتمتة", description: error instanceof Error ? error.message : "حاول مرة أخرى", variant: "destructive" });
    }
  };

  if (isLoading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">جاري تحميل الالتزام...</div>;
  }

  if (!commitment) {
    return (
      <div className="py-16 text-center">
        <p className="font-medium">الالتزام غير موجود</p>
        <Button variant="link" onClick={() => setLocation("/commitments")}>العودة إلى التزاماتي</Button>
      </div>
    );
  }

  const isCompleted = commitment.status === "completed";

  return (
    <div className="space-y-5 py-4" dir="rtl">
      <button type="button" onClick={() => setLocation("/commitments")} className="inline-flex items-center gap-2 text-sm font-medium text-primary">
        <ArrowRight className="h-4 w-4" />
        العودة إلى التزاماتي
      </button>

      <Card className={isCompleted ? "border-emerald-200 bg-emerald-50/40" : ""}>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-muted px-2.5 py-1">{typeLabels[commitment.type] || "عام"}</span>
                <span className="rounded-full bg-muted px-2.5 py-1">{frequencyLabels[commitment.frequency] || "مرة واحدة"}</span>
              </div>
              <h1 className={"text-2xl font-bold " + (isCompleted ? "text-muted-foreground line-through" : "")}>{commitment.title}</h1>
              <p className="mt-2 inline-flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarDays className="h-4 w-4" />
                {formatDate(commitment.dueDate)}
              </p>
            </div>
            <Button
              type="button"
              variant={isCompleted ? "outline" : "default"}
              onClick={() => updateStatus.mutate({ id: commitment.id, status: isCompleted ? "active" : "completed" })}
            >
              <CircleCheck className="h-4 w-4" />
              {isCompleted ? "إعادة فتح" : "تم الإنجاز"}
            </Button>
          </div>

          {commitment.amount || commitment.personName || commitment.assetName || commitment.notes ? (
            <div className="mt-5 grid gap-3 border-t pt-4 text-sm sm:grid-cols-2">
              {commitment.amount ? <p><span className="text-muted-foreground">المبلغ:</span> {commitment.amount.toFixed(3)} ر.ع</p> : null}
              {commitment.personName ? <p><span className="text-muted-foreground">الشخص:</span> {commitment.personName}</p> : null}
              {commitment.assetName ? <p><span className="text-muted-foreground">مرتبط بـ:</span> {commitment.assetName}</p> : null}
              {commitment.notes ? <p className="sm:col-span-2"><span className="text-muted-foreground">ملاحظة:</span> {commitment.notes}</p> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-violet-200 bg-gradient-to-br from-violet-50/70 to-background">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg"><BellRing className="h-5 w-5 text-violet-700" />أتمتة هذا الالتزام</CardTitle>
          <p className="text-sm text-muted-foreground">حددها مرة واحدة، والنظام يتولى التذكير والتصعيد والإغلاق.</p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium">متى يذكّرك؟</p>
            <div className="flex flex-wrap gap-2">
              {([{ value: 0, label: "يوم الموعد" }, { value: 1, label: "قبل يوم" }, { value: 3, label: "قبل 3 أيام" }, { value: 7, label: "قبل أسبوع" }] as const).map((option) => (
                <Button key={option.value} type="button" size="sm" variant={reminderDaysBefore === option.value ? "default" : "outline"} onClick={() => setReminderDaysBefore(option.value)}>{option.label}</Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium"><ShieldAlert className="h-4 w-4 text-amber-600" />متى يصبح الأمر عاجلًا؟</p>
            <div className="flex flex-wrap gap-2">
              {([{ value: null, label: "بدون تصعيد" }, { value: 1, label: "بعد يوم" }, { value: 3, label: "بعد 3 أيام" }, { value: 7, label: "بعد أسبوع" }] as const).map((option) => (
                <Button key={option.label} type="button" size="sm" variant={escalateAfterDays === option.value ? "default" : "outline"} onClick={() => setEscalateAfterDays(option.value)}>{option.label}</Button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border bg-background/70 p-3">
            <div>
              <p className="text-sm font-medium">الإغلاق عند وصول إثبات</p>
              <p className="mt-1 text-xs text-muted-foreground">عند إضافة إيصال أو مستند، يعتبر النظام الالتزام منجزًا تلقائيًا.</p>
            </div>
            <Switch checked={autoCloseOnProof} onCheckedChange={setAutoCloseOnProof} aria-label="الإغلاق التلقائي عند الإثبات" />
          </div>

          <Button type="button" onClick={handleSaveAutomation} disabled={updateCommitment.isPending}>
            <Save className="h-4 w-4" />{updateCommitment.isPending ? "جارٍ الحفظ..." : "حفظ الأتمتة"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-primary/15 bg-gradient-to-br from-primary/5 to-background">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg"><UserRoundPlus className="h-5 w-5 text-primary" />إسناد لشخص آخر</CardTitle>
          <p className="text-sm text-muted-foreground">أرسل المهمة إلى مستخدم مسجّل. سيرى العنوان والموعد فقط، وليس المبلغ أو الملاحظات أو الإثباتات.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {availablePeople.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">أشخاص تعاملت معهم سابقًا</p>
              <div className="flex flex-wrap gap-2">
                {availablePeople.map((person) => (
                  <Button key={person.id} type="button" size="sm" variant={assigneeEmail === person.email ? "default" : "outline"} onClick={() => setAssigneeEmail(person.email)}>
                    {person.name}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <form onSubmit={handleShare} className="flex flex-col gap-2 sm:flex-row">
            <Input type="email" value={assigneeEmail} onChange={(event) => setAssigneeEmail(event.target.value)} placeholder="بريد الشخص المسجّل في التزام" aria-label="بريد الشخص" required />
            <Button type="submit" disabled={createShare.isPending} className="sm:shrink-0">{createShare.isPending ? "جارٍ الإرسال..." : "إسناد المهمة"}</Button>
          </form>

          {shares.length > 0 ? (
            <div className="divide-y rounded-xl border bg-background/60">
              {shares.map((share) => {
                const reviewNote = reviewNotes[share.id] ?? "";
                const statusLabel = share.status === "pending" ? "بانتظار الرد"
                  : share.status === "accepted" ? "قيد التنفيذ"
                    : share.status === "completed" ? "بانتظار اعتمادك"
                      : share.status === "approved" ? "تم الاعتماد"
                        : share.status === "declined" ? "اعتذر"
                          : "تم الإلغاء";
                return (
                  <div key={share.id} className="space-y-3 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{share.assigneeName}</p>
                        <p className="truncate text-xs text-muted-foreground">{share.assigneeEmail}</p>
                      </div>
                      <span className={"rounded-full px-2.5 py-1 text-xs " + (share.status === "completed" ? "bg-amber-100 text-amber-800" : share.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground")}>{statusLabel}</span>
                      {share.status === "pending" || share.status === "accepted" ? <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={revokeShare.isPending} onClick={() => revokeShare.mutate(share.id)}><X className="h-4 w-4" />إلغاء</Button> : null}
                    </div>

                    {share.completionNote ? <p className="rounded-lg bg-muted/40 p-2 text-xs text-foreground">ملاحظة الإنجاز: {share.completionNote}</p> : null}
                    {share.reviewNote && share.status === "accepted" ? <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">ملاحظتك السابقة للمكلّف: {share.reviewNote}</p> : null}

                    {share.status === "completed" ? (
                      <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                        <p className="font-medium text-amber-900">راجع النتيجة ثم اعتمدها أو أعدها مع توضيح المطلوب.</p>
                        <Input value={reviewNote} onChange={(event) => setReviewNotes((current) => ({ ...current, [share.id]: event.target.value }))} maxLength={500} placeholder="ملاحظة عند الإعادة للتعديل" />
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Button type="button" disabled={reviewShare.isPending} onClick={() => reviewShare.mutate({ shareId: share.id, action: "approve" })}><CircleCheck className="h-4 w-4" />اعتماد الإنجاز</Button>
                          <Button type="button" variant="outline" disabled={reviewShare.isPending || !reviewNote.trim()} onClick={() => reviewShare.mutate({ shareId: share.id, action: "rework", reviewNote: reviewNote.trim() })}><RotateCcw className="h-4 w-4" />إعادة للتعديل</Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between gap-3 text-lg">
            <span>خطوات التنفيذ</span>
            <span className="text-sm font-normal text-muted-foreground">{completedSteps} من {steps.length} · {progress}%</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={handleAddStep} className="flex gap-2">
            <Input value={stepTitle} onChange={(event) => setStepTitle(event.target.value)} placeholder="أضف خطوة بسيطة" />
            <Button type="submit" size="icon" aria-label="إضافة خطوة" disabled={createStep.isPending}><Plus className="h-4 w-4" /></Button>
          </form>

          {steps.length === 0 ? (
            <p className="rounded-xl bg-muted/40 p-4 text-center text-sm text-muted-foreground">لا توجد خطوات. أضفها فقط إذا كان الالتزام يحتاج أكثر من إجراء.</p>
          ) : (
            <div className="divide-y rounded-xl border">
              {steps.map((step) => (
                <div key={step.id} className="flex items-center gap-3 p-3">
                  <button type="button" aria-label={step.isCompleted ? "إعادة فتح الخطوة" : "إكمال الخطوة"} onClick={() => toggleStep.mutate(step.id)} className="text-primary">
                    {step.isCompleted ? <Check className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                  </button>
                  <span className={"min-w-0 flex-1 text-sm " + (step.isCompleted ? "text-muted-foreground line-through" : "")}>{step.title}</span>
                  <Button type="button" size="icon" variant="ghost" aria-label="حذف الخطوة" onClick={() => deleteStep.mutate(step.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg"><FileCheck2 className="h-5 w-5 text-primary" />إثبات الإنجاز</CardTitle>
          <p className="text-sm text-muted-foreground">أضف رقم إيصال أو رابطاً أو ملاحظة تؤكد أن الالتزام تم.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleAddProof} className="grid gap-3 md:grid-cols-[140px_1fr_1fr_auto]">
            <div className="space-y-2">
              <Label htmlFor="proof-kind">النوع</Label>
              <select id="proof-kind" value={proofKind} onChange={(event) => setProofKind(event.target.value as "note" | "link" | "receipt")} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="note">ملاحظة</option>
                <option value="receipt">إيصال</option>
                <option value="link">رابط</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="proof-label">العنوان</Label>
              <Input id="proof-label" value={proofLabel} onChange={(event) => setProofLabel(event.target.value)} placeholder="مثال: إيصال الدفع" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proof-value">التفاصيل</Label>
              {proofKind === "note" ? (
                <Textarea id="proof-value" value={proofValue} onChange={(event) => setProofValue(event.target.value)} placeholder="اكتب ملاحظة قصيرة" rows={1} />
              ) : (
                <Input id="proof-value" value={proofValue} onChange={(event) => setProofValue(event.target.value)} placeholder={proofKind === "link" ? "https://..." : "رقم الإيصال"} />
              )}
            </div>
            <Button type="submit" className="self-end" disabled={createProof.isPending}>إضافة</Button>
          </form>

          {proofs.length > 0 ? (
            <div className="grid gap-2">
              {proofs.map((proof) => (
                <div key={proof.id} className="flex items-start gap-3 rounded-xl border p-3">
                  {proof.kind === "link" ? <Link2 className="mt-0.5 h-4 w-4 text-primary" /> : <Receipt className="mt-0.5 h-4 w-4 text-primary" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{proof.label}</p>
                    {proof.kind === "link" ? (
                      <a href={proof.value} target="_blank" rel="noreferrer" className="break-all text-sm text-primary underline">{proof.value}</a>
                    ) : (
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{proof.value}</p>
                    )}
                  </div>
                  <Button type="button" size="icon" variant="ghost" aria-label="حذف الإثبات" onClick={() => deleteProof.mutate(proof.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
