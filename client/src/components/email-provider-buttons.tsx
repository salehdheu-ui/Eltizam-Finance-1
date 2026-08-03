import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type EmailProvider = "google" | "microsoft";

function GoogleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0">
      <path fill="#4285F4" d="M21.8 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.5a4.7 4.7 0 0 1-2 3.1v2.6h3.3c1.9-1.8 3-4.4 3-7.6Z" />
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.8-2.3l-3.3-2.6c-.9.6-2.1 1-3.5 1-2.6 0-4.8-1.8-5.6-4.1H3v2.7A10.2 10.2 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.9V7.4H3A10.1 10.1 0 0 0 3 16.7L6.4 14Z" />
      <path fill="#EA4335" d="M12 6c1.6 0 3 .5 4.1 1.6l3.1-3A10.1 10.1 0 0 0 3 7.4l3.4 2.7C7.2 7.7 9.4 6 12 6Z" />
    </svg>
  );
}

function MicrosoftLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0">
      <path fill="#F25022" d="M2 2h9v9H2z" />
      <path fill="#7FBA00" d="M13 2h9v9h-9z" />
      <path fill="#00A4EF" d="M2 13h9v9H2z" />
      <path fill="#FFB900" d="M13 13h9v9h-9z" />
    </svg>
  );
}

type EmailProviderButtonsProps = {
  onSelect: (provider: EmailProvider) => void;
  pendingProvider?: EmailProvider | null;
  googleDisabled?: boolean;
  microsoftDisabled?: boolean;
};

export function EmailProviderButtons({
  onSelect,
  pendingProvider = null,
  googleDisabled = false,
  microsoftDisabled = false,
}: EmailProviderButtonsProps) {
  const isPending = pendingProvider !== null;

  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="outline"
        className="h-13 w-full rounded-full border-border bg-background text-base font-medium shadow-none hover:bg-muted/50"
        disabled={googleDisabled || isPending}
        onClick={() => onSelect("google")}
      >
        {pendingProvider === "google" ? <Loader2 className="h-5 w-5 animate-spin" /> : <GoogleLogo />}
        المتابعة مع Google
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-13 w-full rounded-full border-border bg-background text-base font-medium shadow-none hover:bg-muted/50"
        disabled={microsoftDisabled || isPending}
        onClick={() => onSelect("microsoft")}
      >
        {pendingProvider === "microsoft" ? <Loader2 className="h-5 w-5 animate-spin" /> : <MicrosoftLogo />}
        المتابعة مع Microsoft
      </Button>
    </div>
  );
}
