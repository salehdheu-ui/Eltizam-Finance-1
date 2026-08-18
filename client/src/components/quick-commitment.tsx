import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { Check, Loader2, Sparkles, X } from "lucide-react";

type Draft = {
  title: string;
  amount: number | null;
  frequency: "one_time" | "daily" | "weekly" | "monthly" | "yearly";
  type: string;
  dueDate: number | null;
  personName: string | null;
  confidence: number;
  source: "rules" | "claude";
};

const FREQUENCY_LABELS: Record<string, string> = {
  one_time: "مرة واحدة", daily: "يومي", weekly: "أسبوعي", monthly: "شهري", yearly: "سنوي",
};

const TYPE_LABELS: Record<string, string> = {
  financial: "مالي", government: "حكومي", home: "منزل", vehicle: "مركبة",
  health: "صحة", family: "أسرة", work: "عمل", personal: "شخصي",
};

export default function QuickCommitment() {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);

  const understand = useMutation({
    mutationFn: async (value: string) => {
      const response = await apiRequest("POST", "/api/understand/commitment", { text: value });
      return response.json() as Promise<Draft>;
    },
    onSuccess: setDraft,
    onError: (error: Error) => toast({ title: "تعذر الفهم", description: error.message, variant: "destructive" }),
  });

  const create = useMutation({
    mutationFn: (value: Draft) =>
      apiRequest("POST", "/api/commitments", {
        title: value.title,
        type: value.type,
        frequency: value.frequency,
        dueDate: value.dueDate,
        amount: value.amount,
        personName: value.personName,
        notes: "",
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/commitments"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/occurrences"] }),
      ]);
      setText("");
      setDraft(null);
      toast({ title: "أُضيف الالتزام" });
    },
    onError: (error: Error) => toast({ title: "تعذرت الإضافة", description: error.message, variant: "destructive" }),
  });

  const dueLabel = draft?.dueDate
    ? new Intl.DateTimeFormat("ar-OM", { dateStyle: "medium" }).format(new Date(draft.dueDate * 1000))
    : null;

  return (
    <Card className="p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-bold">أضف التزامك بسرعة</h2>
          <p className="text-sm text-muted-foreground">مثل: إيجار البيت 300 ريال كل شهر يوم 5</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && text.trim().length >= 2) {
              event.preventDefault();
              understand.mutate(text);
            }
          }}
          placeholder="اكتب بلغتك العادية…"
          className="h-12 flex-1"
        />
        <Button
          className="h-12 shrink-0"
          onClick={() => understand.mutate(text)}
          disabled={text.trim().length < 2 || understand.isPending}
        >
          {understand.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "افهمه"}
        </Button>
      </div>

      {draft ? (
        <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-bold">{draft.title}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-background px-2 py-0.5">{TYPE_LABELS[draft.type] || draft.type}</span>
                <span className="rounded-full bg-background px-2 py-0.5">{FREQUENCY_LABELS[draft.frequency]}</span>
                {dueLabel ? <span className="rounded-full bg-background px-2 py-0.5">{dueLabel}</span> : null}
                {draft.amount ? (
                  <span className="rounded-full bg-background px-2 py-0.5">
                    <CurrencyDisplay amount={draft.amount} fractionDigits={3} />
                  </span>
                ) : null}
              </div>
              {draft.confidence < 0.6 ? (
                <p className="mt-2 text-xs text-amber-700">لم نفهم كل التفاصيل — راجعها قبل الإضافة.</p>
              ) : null}
            </div>
            <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setDraft(null)} aria-label="إلغاء">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <Button className="mt-3 w-full" onClick={() => create.mutate(draft)} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            أضف الالتزام
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
