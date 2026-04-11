import { cn, formatCurrency } from "@/lib/utils";

type OmaniCurrencySymbolProps = {
  className?: string;
};

type CurrencyDisplayProps = {
  amount: number;
  fractionDigits?: number;
  className?: string;
  symbolClassName?: string;
  numberClassName?: string;
  prefix?: string;
  suffix?: string;
};

export function OmaniCurrencySymbol({ className }: OmaniCurrencySymbolProps) {
  return (
    <svg viewBox="0 0 372 200" aria-hidden="true" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M51 88H372L348 132H25L51 88Z" fill="currentColor" />
      <path d="M14 153H338L314 197H-10L14 153Z" fill="currentColor" />
      <path d="M209 29C201 18 187 8 171 4C152 -1 132 0 118 9C100 20 90 43 90 75V88H123V77C123 56 129 44 140 38C149 33 161 33 173 37C186 42 197 51 205 60L209 29Z" fill="currentColor" />
      <path d="M131 88H199C211 101 228 113 249 122C265 129 285 136 311 142H243C222 136 204 128 188 118C165 104 146 90 131 88Z" fill="currentColor" />
    </svg>
  );
}

export function CurrencyDisplay({
  amount,
  fractionDigits = 2,
  className,
  symbolClassName,
  numberClassName,
  prefix,
  suffix,
}: CurrencyDisplayProps) {
  return (
    <span dir="ltr" className={cn("inline-flex items-center gap-1 whitespace-nowrap align-baseline", className)}>
      {prefix ? <span>{prefix}</span> : null}
      <OmaniCurrencySymbol className={cn("h-[0.9em] w-auto shrink-0", symbolClassName)} />
      <span className={numberClassName}>{formatCurrency(amount, fractionDigits)}</span>
      {suffix ? <span>{suffix}</span> : null}
    </span>
  );
}
