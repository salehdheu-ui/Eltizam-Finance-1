import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Obligation } from "@shared/schema"

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

  return d.toLocaleDateString("ar-OM", { day: "numeric", month: "long" })
}

export function formatObligationDueDate(obligation: Obligation) {
  if (obligation.frequency === "monthly" && obligation.dueDay) {
    return `${obligation.dueDay} من الشهر`
  }

  if (obligation.frequency === "yearly" && obligation.dueMonth && obligation.dueDay) {
    const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
    return `${obligation.dueDay} ${months[obligation.dueMonth - 1]}`
  }

  if (obligation.frequency === "one_time" && obligation.dueDate) {
    return toDate(obligation.dueDate).toLocaleDateString("ar-OM", {
      day: "numeric",
      month: "short",
    })
  }

  return "غير محدد"
}

export type UpcomingObligation = Obligation & { daysLeft: number }

export function getUpcomingObligations(obligations: Obligation[] | undefined, limit = 5): UpcomingObligation[] {
  if (!obligations) return []

  const now = new Date()
  const currentDay = now.getDate()
  const currentMonth = now.getMonth() + 1

  return obligations
    .filter((obligation) => obligation.isActive)
    .map((obligation) => {
      let daysLeft = 0

      if (obligation.frequency === "monthly" && obligation.dueDay) {
        daysLeft = obligation.dueDay - currentDay
        if (daysLeft < 0) {
          daysLeft += 30
        }
      } else if (obligation.frequency === "yearly" && obligation.dueMonth && obligation.dueDay) {
        const monthsLeft = obligation.dueMonth - currentMonth
        if (monthsLeft < 0) {
          daysLeft = (12 + monthsLeft) * 30 + (obligation.dueDay - currentDay)
        } else if (monthsLeft === 0) {
          daysLeft = obligation.dueDay - currentDay
          if (daysLeft < 0) {
            daysLeft += 365
          }
        } else {
          daysLeft = monthsLeft * 30 + (obligation.dueDay - currentDay)
        }
      } else if (obligation.frequency === "one_time" && obligation.dueDate) {
        const dueDate = toDate(obligation.dueDate)
        const diffTime = dueDate.getTime() - now.getTime()
        daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      }

      return { ...obligation, daysLeft }
    })
    .filter((obligation): obligation is UpcomingObligation => obligation.daysLeft >= 0)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, limit)
}
