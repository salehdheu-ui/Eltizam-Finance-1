export type SavingsGoalDraft = {
  id: string;
  planId: string;
  planTitle: string;
  title: string;
  targetAmount: number;
  monthlyAmount: number;
  years: 3 | 5 | 10;
  createdAt: number;
};

export const SAVINGS_GOALS_STORAGE_KEY = "eltizam-savings-goals";

export function loadSavingsGoals() {
  if (typeof window === "undefined") {
    return [] as SavingsGoalDraft[];
  }

  const savedGoalsRaw = window.localStorage.getItem(SAVINGS_GOALS_STORAGE_KEY);
  if (!savedGoalsRaw) {
    return [] as SavingsGoalDraft[];
  }

  try {
    const parsedGoals = JSON.parse(savedGoalsRaw) as SavingsGoalDraft[];
    return Array.isArray(parsedGoals) ? parsedGoals : [];
  } catch {
    window.localStorage.removeItem(SAVINGS_GOALS_STORAGE_KEY);
    return [] as SavingsGoalDraft[];
  }
}

export function saveSavingsGoals(goals: SavingsGoalDraft[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SAVINGS_GOALS_STORAGE_KEY, JSON.stringify(goals));
}

export function calculateSavingsGoalProgress(goal: SavingsGoalDraft) {
  if (goal.targetAmount <= 0) {
    return 0;
  }

  const savedAmount = goal.monthlyAmount * goal.years * 12;
  return Math.min((savedAmount / goal.targetAmount) * 100, 100);
}

export function calculateSavingsGoalMonths(goal: SavingsGoalDraft) {
  if (goal.monthlyAmount <= 0) {
    return null;
  }

  return Math.max(1, Math.ceil(goal.targetAmount / goal.monthlyAmount));
}
