import { useCallback, useEffect, useState } from "react";
import { Download, Plus, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  canPromptInstall,
  isIosDevice,
  isStandalone,
  promptInstall,
  subscribeToInstallAvailability,
} from "@/lib/pwa";

/** Remembers that the full sheet has had its one automatic appearance. */
const SEEN_KEY = "eltizam:install-prompt-seen";

function markSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, "true");
  } catch {
    // Private browsing can refuse storage; showing the sheet again is a far
    // smaller problem than crashing the app over it.
  }
}

function hasBeenSeen() {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Invites the user to install the app once, then gets out of the way.
 *
 * Android and iOS need different things: Chrome hands over an install dialog we
 * can open directly, while Safari installs only through its own share sheet, so
 * iOS gets instructions rather than a button that cannot do anything. Once the
 * sheet has been shown and dismissed it never opens by itself again — the small
 * button in the corner is there for anyone who wants it later.
 */
export function InstallPrompt() {
  const { toast } = useToast();
  const [installed, setInstalled] = useState(() => isStandalone());
  const [promptReady, setPromptReady] = useState(() => canPromptInstall());
  const [isOpen, setIsOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => hasBeenSeen());

  const ios = isIosDevice();
  // On iOS the invitation is all we have, so it does not wait for a browser
  // event that will never arrive.
  const canOffer = !installed && (promptReady || ios);

  useEffect(() => subscribeToInstallAvailability(() => {
    setPromptReady(canPromptInstall());
    setInstalled(isStandalone());
  }), []);

  useEffect(() => {
    const onInstalled = () => {
      setInstalled(true);
      setIsOpen(false);
      toast({ title: "تم تثبيت التطبيق", description: "ستجده الآن بين تطبيقاتك." });
    };
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, [toast]);

  // The one automatic appearance. Delayed so it does not collide with the first
  // paint, and never repeated once dismissed.
  useEffect(() => {
    if (!canOffer || dismissed) return;
    const timer = setTimeout(() => setIsOpen(true), 2500);
    return () => clearTimeout(timer);
  }, [canOffer, dismissed]);

  const close = useCallback(() => {
    setIsOpen(false);
    setDismissed(true);
    markSeen();
  }, []);

  const handleInstall = useCallback(async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      setIsOpen(false);
      markSeen();
      setDismissed(true);
      return;
    }
    if (outcome === "unavailable") {
      toast({
        title: "التثبيت غير متاح الآن",
        description: "افتح التطبيق من متصفح Chrome أو Edge وحاول مرة أخرى.",
        variant: "destructive",
      });
    }
    close();
  }, [close, toast]);

  if (!canOffer) return null;

  if (!isOpen) {
    // z-50 clears the bottom navigation: its container is a full-width strip
    // that stays transparent on large screens but still swallows clicks, and at
    // `lg:bottom-8` this button sits inside it.
    return (
      <div className="fixed bottom-[5.5rem] right-3 z-50 sm:bottom-24 sm:right-6 lg:bottom-8 lg:right-8">
        <Button
          size="icon"
          variant="secondary"
          className="h-11 w-11 rounded-full border border-border/70 bg-background shadow-lg"
          onClick={() => setIsOpen(true)}
          aria-label="تثبيت التطبيق على الجهاز"
          title="تثبيت التطبيق على الجهاز"
          data-testid="button-install-app"
        >
          <Download className="h-5 w-5 text-primary" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/40 animate-in fade-in duration-200"
        onClick={close}
        aria-hidden="true"
      />
      <div
        className="fixed inset-x-0 bottom-0 z-50 animate-in slide-in-from-bottom duration-300"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-prompt-title"
        dir="rtl"
      >
        <div className="mx-auto w-full max-w-md rounded-t-3xl border border-border bg-background p-5 pb-8 shadow-2xl">
          <div className="mb-4 flex items-start gap-3">
            <img src="/icons/icon-192.png" alt="" className="h-14 w-14 shrink-0 rounded-2xl shadow-sm" />
            <div className="min-w-0 flex-1">
              <h2 id="install-prompt-title" className="text-lg font-bold">ثبّت التزام على جهازك</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                يفتح مباشرة مثل أي تطبيق، ويعمل بدون إنترنت، وتصلك إشعارات الحركات البنكية فور وصولها.
              </p>
            </div>
            <Button variant="ghost" size="icon" className="-mt-1 shrink-0" onClick={close} aria-label="إغلاق">
              <X className="h-5 w-5" />
            </Button>
          </div>

          {ios ? (
            <>
              <ol className="space-y-3 rounded-2xl bg-muted/50 p-4 text-sm">
                <li className="flex items-center gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">١</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    اضغط زر المشاركة
                    <Share className="inline h-4 w-4 text-primary" />
                    في شريط Safari
                  </span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">٢</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    اختر «إضافة إلى الشاشة الرئيسية»
                    <Plus className="inline h-4 w-4 text-primary" />
                  </span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">٣</span>
                  <span>افتح «التزام» من الشاشة الرئيسية</span>
                </li>
              </ol>
              <p className="mt-3 text-center text-xs leading-5 text-muted-foreground">
                الإشعارات على الآيفون تعمل بعد فتح التطبيق من الشاشة الرئيسية.
              </p>
              <Button className="mt-4 h-12 w-full text-base font-bold" onClick={close}>فهمت</Button>
            </>
          ) : (
            <div className="space-y-2">
              <Button className="h-12 w-full text-base font-bold" onClick={handleInstall} data-testid="button-confirm-install">
                <Download className="h-5 w-5" />
                تثبيت الآن
              </Button>
              <Button variant="ghost" className="h-11 w-full" onClick={close}>ليس الآن</Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
