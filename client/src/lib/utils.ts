import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Obligation } from "@shared/schema"

const obligationMonths = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
const englishNumberLocale = "en-US"
const englishDateLocale = "en-GB"
const likelyMojibakePattern = /[ØÙÂ][\x80-\xFF]?/

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function toDate(dateInput: string | Date | number) {
  if (typeof dateInput === "number") {
    return new Date(dateInput * 1000)
  }

  if (typeof dateInput === "string") {
    const num = parseInt(dateInput)
    if (!isNaN(num) && num > 1000000000) {
      return new Date(num * 1000)
    }
  }

  return new Date(dateInput)
}

export function formatRelativeArabicDate(dateInput: string | Date | number) {
  const d = toDate(dateInput)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) return "اليوم"
  if (days === 1) return "أمس"

  return formatDate(d, { day: "2-digit", month: "2-digit", year: "numeric" })
}

export function isObligationEnded(obligation: Obligation) {
  return !!obligation.endDate && obligation.endDate <= Math.floor(Date.now() / 1000)
}

export function getObligationStatusLabel(obligation: Obligation) {
  if (isObligationEnded(obligation)) return "منتهي"
  return obligation.isActive ? "نشط" : "غير نشط"
}

export function formatObligationDueDate(obligation: Obligation) {
  if (obligation.scheduleType === "variable" && obligation.dueDate) {
    return formatDate(obligation.dueDate)
  }

  if (obligation.frequency === "monthly" && obligation.dueDay) {
    return `${formatNumber(obligation.dueDay)} من الشهر`
  }

  if (obligation.frequency === "yearly" && obligation.dueMonth && obligation.dueDay) {
    return `${formatNumber(obligation.dueDay)} ${obligationMonths[obligation.dueMonth - 1]}`
  }

  if (obligation.frequency === "one_time" && obligation.dueDate) {
    return formatDate(obligation.dueDate)
  }

  return "غير محدد"
}

export function formatNumber(value: number, minimumFractionDigits = 0, maximumFractionDigits = minimumFractionDigits) {
  return new Intl.NumberFormat(englishNumberLocale, {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value)
}

export function formatCurrency(value: number, fractionDigits = 3) {
  return formatNumber(value, fractionDigits, fractionDigits)
}

export function parseNumericInput(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  const numeralNormalized = trimmed
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
    .replace(/[٫]/g, ".")
    .replace(/[٬،]/g, ",")
    .replace(/\s+/g, "")

  const lastDotIndex = numeralNormalized.lastIndexOf(".")
  const lastCommaIndex = numeralNormalized.lastIndexOf(",")
  const decimalSeparatorIndex = Math.max(lastDotIndex, lastCommaIndex)

  const normalized = decimalSeparatorIndex >= 0
    ? `${numeralNormalized.slice(0, decimalSeparatorIndex).replace(/[.,]/g, "")}.${numeralNormalized.slice(decimalSeparatorIndex + 1).replace(/[.,]/g, "")}`
    : numeralNormalized.replace(/[.,]/g, "")

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function formatPercentage(value: number, fractionDigits = 1) {
  return `${formatNumber(value, fractionDigits, fractionDigits)}%`
}

export function formatDate(dateInput: string | Date | number, options?: Intl.DateTimeFormatOptions) {
  return toDate(dateInput).toLocaleDateString(englishDateLocale, options)
}

export function formatTime(dateInput: string | Date | number, options?: Intl.DateTimeFormatOptions) {
  return toDate(dateInput).toLocaleTimeString(englishDateLocale, {
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  })
}

export function formatMonthKeyLabel(monthKey: string | null | undefined) {
  if (!monthKey) {
    return "لم يطبق بعد"
  }

  const match = /^(\d{4})-(\d{2})$/.exec(monthKey)
  if (!match) {
    return monthKey
  }

  const [, yearText, monthText] = match
  const year = Number(yearText)
  const month = Number(monthText)

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return monthKey
  }

  return `${obligationMonths[month - 1]} ${formatNumber(year)}`
}

export function normalizeArabicText(text: string | null | undefined) {
  if (!text) {
    return ""
  }

  if (!likelyMojibakePattern.test(text)) {
    return text
  }

  try {
    const decoded = decodeURIComponent(escape(text))

    if (/[\u0600-\u06FF]/.test(decoded)) {
      return decoded
    }
  } catch {
    return text
  }

  return text
}

export type UpcomingObligation = Obligation & { daysLeft: number }

function differenceInDays(from: Date, to: Date) {
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}

function getNextMonthlyOccurrence(now: Date, dueDay: number) {
  const occurrence = new Date(now.getFullYear(), now.getMonth(), dueDay)
  if (occurrence.getTime() < now.getTime()) {
    return new Date(now.getFullYear(), now.getMonth() + 1, dueDay)
  }
  return occurrence
}

function getNextYearlyOccurrence(now: Date, dueMonth: number, dueDay: number) {
  let occurrence = new Date(now.getFullYear(), dueMonth - 1, dueDay)
  if (occurrence.getTime() < now.getTime()) {
    occurrence = new Date(now.getFullYear() + 1, dueMonth - 1, dueDay)
  }
  return occurrence
}

export function getUpcomingObligations(obligations: Obligation[] | undefined, limit = 5): UpcomingObligation[] {
  if (!obligations) return []

  const now = new Date()

  return obligations
    .filter((obligation) => obligation.isActive && !isObligationEnded(obligation))
    .map((obligation) => {
      let daysLeft = Number.POSITIVE_INFINITY

      if (obligation.scheduleType === "variable" && obligation.dueDate) {
        daysLeft = differenceInDays(now, toDate(obligation.dueDate))
      } else if (obligation.frequency === "monthly" && obligation.dueDay) {
        daysLeft = differenceInDays(now, getNextMonthlyOccurrence(now, obligation.dueDay))
      } else if (obligation.frequency === "yearly" && obligation.dueMonth && obligation.dueDay) {
        daysLeft = differenceInDays(now, getNextYearlyOccurrence(now, obligation.dueMonth, obligation.dueDay))
      } else if (obligation.frequency === "one_time" && obligation.dueDate) {
        daysLeft = differenceInDays(now, toDate(obligation.dueDate))
      }

      return { ...obligation, daysLeft }
    })
    .filter((obligation): obligation is UpcomingObligation => Number.isFinite(obligation.daysLeft) && obligation.daysLeft >= 0)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, limit)
}
