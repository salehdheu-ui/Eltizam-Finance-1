import { ArrowDown, ArrowUp, Eye, EyeOff, LayoutGrid, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAdminSaveAppSections, useAppSections, type AppSectionConfig } from "@/lib/hooks";

export default function AdminSectionsCard() {
  const { toast } = useToast();
  const { data: sections = [], isLoading } = useAppSections();
  const saveSections = useAdminSaveAppSections();
  const enabledCount = sections.filter((section) => section.isEnabled).length;
  const bottomSectionKeys = new Set(sections.filter((section) => section.isEnabled).slice(0, 4).map((section) => section.key));

  const persist = async (nextSections: AppSectionConfig[], successMessage: string) => {
    try {
      await saveSections.mutateAsync(nextSections.map(({ key, isEnabled }) => ({ key, isEnabled })));
      toast({ title: "تم تحديث الأقسام", description: successMessage });
    } catch (error) {
      toast({
        title: "تعذر تحديث الأقسام",
        description: error instanceof Error ? error.message : "يرجى المحاولة مرة أخرى",
        variant: "destructive",
      });
    }
  };

  const toggleSection = (sectionKey: AppSectionConfig["key"]) => {
    const section = sections.find((item) => item.key === sectionKey);
    if (!section || saveSections.isPending) return;
    const nextSections = sections.map((item) => item.key === sectionKey ? { ...item, isEnabled: !item.isEnabled } : item);
    void persist(nextSections, section.isEnabled ? `تم إخفاء قسم «${section.label}»` : `تم تفعيل قسم «${section.label}»`);
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= sections.length || saveSections.isPending) return;

    const nextSections = [...sections];
    [nextSections[index], nextSections[targetIndex]] = [nextSections[targetIndex], nextSections[index]];
    void persist(nextSections, `تم نقل قسم «${sections[index].label}» ${direction === -1 ? "للأعلى" : "للأسفل"}`);
  };

  return (
    <Card className="border-border/50 shadow-sm">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">التحكم بأقسام المنصة</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">فعّل أو أخفِ أي قسم، وغيّر ترتيبه. أول أربعة أقسام مفعّلة تظهر في الشريط السفلي، والبقية داخل القائمة.</p>
          </div>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LayoutGrid className="h-5 w-5" />
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="divide-y overflow-hidden rounded-xl border">
            {sections.map((section, index) => (
              <div key={section.key} className="flex items-center gap-3 bg-background p-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${section.isEnabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {section.isEnabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{section.label}</p>
                      {bottomSectionKeys.has(section.key) ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">الشريط السفلي</span> : null}
                      {!section.isEnabled ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">مخفي</span> : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button type="button" size="icon" variant="ghost" aria-label={`نقل ${section.label} للأعلى`} disabled={index === 0 || saveSections.isPending} onClick={() => moveSection(index, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" aria-label={`نقل ${section.label} للأسفل`} disabled={index === sections.length - 1 || saveSections.isPending} onClick={() => moveSection(index, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Switch checked={section.isEnabled} disabled={saveSections.isPending || (section.isEnabled && enabledCount === 1)} onCheckedChange={() => toggleSection(section.key)} aria-label={section.isEnabled ? `إخفاء ${section.label}` : `تفعيل ${section.label}`} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
