import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  BriefcaseBusiness,
  CalendarDays,
  Car,
  Check,
  ChevronLeft,
  CircleCheck,
  Clock3,
  FileText,
  HeartPulse,
  House,
  Landmark,
  Plus,
  Receipt,
  Trash2,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCommitments, useCreateCommitment, useDeleteCommitment, useUpdateCommitmentStatus } from "@/lib/hooks";
import type { Commitment } from "@shared/schema";
import AutomationPanel from "@/components/automation-panel";
import QuickCommitment from "@/components/quick-commitment";

const typeOptions = [
  { value: "financial", label: "مالي", icon: WalletCards },
  { value: "government", label: "حكومي", icon: Landmark },
  { value: "home", label: "المنزل", icon: House },
  { value: "vehicle", label: "المركبة", icon: Car },
  { value: "health", label: "الصحة", icon: HeartPulse },
  { value: "family", label: "الأسرة", icon: UsersRound },
  { value: "work", label: "العمل", icon: BriefcaseBusiness },
  { value: "personal", label: "شخصي", icon: FileText },
] as const;

const frequencyOptions = [
  { value: "one_time", label: "مرة واحدة" },
  { value: "daily", label: "يومياً" },
  { value: "weekly", label: "أسبوعياً" },
  { value: "monthly", label: "شهرياً" },
  { value: "yearly", label: "سنوياً" },
] as const;

const typeLabels: Record<string, string> = Object.fromEntries(typeOptions.map((option) => [option.value, option.label]));
const frequencyLabels: Record<string, string> = Object.fromEntries(frequencyOptions.map((option) => [option.value, option.label]));

function formatDueDate(timestamp: number | null) {
  if (!timestamp) return "بدون موعد";
  return new Intl.DateTimeFormat("ar-OM", { day: "numeric", month: "short", year: "numeric" }).format(new Date(timestamp * 1000));
}

function toTimestamp(value: string) {
  return value ? Math.floor(new Date(value + "T12:00:00").getTime() / 1000) : null;
}

function getTypeIcon(type: string) {
  return typeOptions.find((option) => option.value === type)?.icon ?? FileText;
}

type CommitmentForm = {
  title: string;
  type: Commitment["type"];
  dueDate: string;
  frequency: Commitment["frequency"];
  amount: string;
  personName: string;
  assetName: string;
  notes: string;
};

const initialForm: CommitmentForm = {
  title: "",
  type: "personal",
  dueDate: "",
  frequency: "one_time",
  amount: "",
  personName: "",
  assetName: "",
  notes: "",
};

export default function Commitments() {
  const [, setLocation] = useLocation();
  const { data: commitments = [], isLoading } = useCommitments();
  const createCommitment = useCreateCommitment();
  const updateStatus = useUpdateCommitmentStatus();
  const deleteCommitment = useDeleteCommitment();
  const [form, setForm] = useState<CommitmentForm>(initialForm);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const visibleCommitments = useMemo(
    () => commitments.filter((commitment) => commitment.status !== "archived"),
    [commitments],
  );

  const updateField = <K extends keyof CommitmentForm>(key: K, value: CommitmentForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim() || createCommitment.isPending) return;

    await createCommitment.mutateAsync({
      title: form.title.trim(),
      type: form.type,
      dueDate: toTimestamp(form.dueDate),
      frequency: form.frequency,
      amount: form.amount ? Number(form.amount) : null,
      personName: form.personName.trim() || null,
      assetName: form.assetName.trim() || null,
      notes: form.notes.trim() || "",
    });

    setForm(initialForm);
    setShowAdvanced(false);
  };

  const handleDelete = async (id: number) => {
    if (window.confirm("هل تريد حذف هذا الالتزام؟")) await deleteCommitment.mutateAsync(id);
  };

  return (
    <div className="space-y-5 py-4" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">التزاماتي</h1>
          <p className="mt-1 text-sm text-muted-foreground">كل ما تريد تذكره أو إنجازه أو متابعته، مالياً أو شخصياً.</p>
        </div>
        <Button type="button" variant="outline" className="gap-2" onClick={() => setLocation("/shared-commitments")}><UsersRound className="h-4 w-4" />مهام مُسندة إليّ</Button>
      </div>

      <QuickCommitment />

      <AutomationPanel />

      <Card className="border-primary/15 bg-gradient-to-br from-primary/5 to-background">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg"><Plus className="h-5 w-5 text-primary" />التزام جديد</CardTitle>
          <p className="text-sm text-muted-foreground">ثلاثة حقول فقط. التفاصيل الأخرى اختيارية.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2 md:col-span-3">
                <Label htmlFor="commitment-title">ما التزامك؟</Label>
                <Input id="commitment-title" value={form.title} onChange={(event) => updateField("title", event.target.value)} placeholder="مثال: تجديد تأمين السيارة" className="h-12" required autoFocus />
              </div>
              <div className="space-y-2">
                <Label htmlFor="commitment-due-date">متى؟</Label>
                <Input id="commitment-due-date" type="date" value={form.dueDate} onChange={(event) => updateField("dueDate", event.target.value)} className="h-12" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="commitment-type">يتعلق بماذا؟</Label>
                <select id="commitment-type" value={form.type} onChange={(event) => updateField("type", event.target.value as Commitment["type"])} className="h-12 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {typeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
            </div>
            <button type="button" className="text-sm font-medium text-primary" onClick={() => setShowAdvanced((visible) => !visible)}>
              {showAdvanced ? "إخفاء الخيارات المتقدمة" : "خيارات متقدمة"}
            </button>

            {showAdvanced ? (
              <div className="grid gap-4 rounded-2xl border border-border/70 bg-muted/20 p-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="commitment-frequency">التكرار</Label>
                  <select id="commitment-frequency" value={form.frequency} onChange={(event) => updateField("frequency", event.target.value as Commitment["frequency"])} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    {frequencyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="commitment-amount">مبلغ اختياري</Label>
                  <Input id="commitment-amount" type="number" min="0" step="0.001" value={form.amount} onChange={(event) => updateField("amount", event.target.value)} placeholder="0.000" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="commitment-person">شخص مرتبط</Label>
                  <Input id="commitment-person" value={form.personName} onChange={(event) => updateField("personName", event.target.value)} placeholder="مثال: أحمد أو المقاول" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="commitment-asset">شيء مرتبط</Label>
                  <Input id="commitment-asset" value={form.assetName} onChange={(event) => updateField("assetName", event.target.value)} placeholder="مثال: السيارة أو المنزل" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="commitment-notes">ملاحظة</Label>
                  <Textarea id="commitment-notes" value={form.notes} onChange={(event) => updateField("notes", event.target.value)} placeholder="أي تفاصيل تساعدك لاحقاً" rows={3} />
                </div>
              </div>
            ) : null}

            <Button type="submit" disabled={createCommitment.isPending} className="h-12 w-full rounded-xl md:w-auto">{createCommitment.isPending ? "جاري الحفظ..." : "إضافة الالتزام"}</Button>
          </form>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg font-bold">القائمة</h2>
        <p className="text-sm text-muted-foreground">{visibleCommitments.length} التزامات ظاهرة</p>
      </div>

      {isLoading ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">جاري تحميل الالتزامات...</CardContent></Card>
      ) : visibleCommitments.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><CircleCheck className="mx-auto mb-3 h-10 w-10 text-primary/60" /><p className="font-medium">لا توجد التزامات بعد</p><p className="mt-1 text-sm text-muted-foreground">ابدأ بالتزام بسيط، وسيقوم النظام بالباقي لاحقاً.</p></CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {visibleCommitments.map((commitment) => {
            const Icon = getTypeIcon(commitment.type);
            const isCompleted = commitment.status === "completed";
            return (
              <Card key={commitment.id} className={isCompleted ? "border-emerald-200 bg-emerald-50/50" : ""}>
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <p className={"font-semibold " + (isCompleted ? "text-muted-foreground line-through" : "")}>{commitment.title}</p>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{typeLabels[commitment.type] || "عام"}</span>
                      <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{formatDueDate(commitment.dueDate)}</span>
                      <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{frequencyLabels[commitment.frequency] || "مرة واحدة"}</span>
                      {commitment.amount ? <span className="inline-flex items-center gap-1"><Receipt className="h-3.5 w-3.5" />{commitment.amount.toFixed(3)} ر.ع</span> : null}
                    </div>
                    {commitment.assetName || commitment.personName ? <p className="mt-2 text-xs text-muted-foreground">{[commitment.assetName, commitment.personName].filter(Boolean).join(" · ")}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button type="button" size="icon" variant="ghost" aria-label="فتح التفاصيل" onClick={() => setLocation("/commitments/" + commitment.id)}><ChevronLeft className="h-4 w-4" /></Button>
                    {!isCompleted ? <Button type="button" size="icon" variant="ghost" aria-label="إكمال الالتزام" onClick={() => updateStatus.mutate({ id: commitment.id, status: "completed" })}><Check className="h-4 w-4 text-emerald-600" /></Button> : null}
                    <Button type="button" size="icon" variant="ghost" aria-label="حذف الالتزام" onClick={() => handleDelete(commitment.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
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
