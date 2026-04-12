export type SavingsGoalDraft = {
  id: string;
  planId: string;
  planTitle: string;
  title: string;
  walletId: number;
  walletName: string;
  targetAmount: number;
  monthlyAmount: number;
  years: 3 | 5 | 10;
  createdAt: number;
};

export type SavingsGoalWalletLike = {
  id: number;
  name: string;
  balance: number;
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
    if (!Array.isArray(parsedGoals)) {
      return [] as SavingsGoalDraft[];
    }

    return parsedGoals.filter((goal) => typeof goal === "object" && goal !== null).map((goal) => ({
      ...goal,
      walletId: typeof goal.walletId === "number" ? goal.walletId : 0,
      walletName: typeof goal.walletName === "string" ? goal.walletName : "",
    }));
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

export function getSavingsGoalWalletBalance(goal: SavingsGoalDraft, wallets: SavingsGoalWalletLike[]) {
  const wallet = wallets.find((item) => item.id === goal.walletId);
  return wallet?.balance ?? 0;
}

export function calculateSavingsGoalSavedAmount(goal: SavingsGoalDraft, wallets: SavingsGoalWalletLike[]) {
  return Math.max(0, getSavingsGoalWalletBalance(goal, wallets));
}

export function calculateSavingsGoalProgress(goal: SavingsGoalDraft, wallets: SavingsGoalWalletLike[]) {
  if (goal.targetAmount <= 0) {
    return 0;
  }

  const savedAmount = calculateSavingsGoalSavedAmount(goal, wallets);
  return Math.min((savedAmount / goal.targetAmount) * 100, 100);
}

export function calculateSavingsGoalRemaining(goal: SavingsGoalDraft, wallets: SavingsGoalWalletLike[]) {
  return Math.max(0, goal.targetAmount - calculateSavingsGoalSavedAmount(goal, wallets));
}

export function calculateSavingsGoalMonths(goal: SavingsGoalDraft) {
  if (goal.monthlyAmount <= 0) {
    return null;
  }

  return Math.max(1, Math.ceil(goal.targetAmount / goal.monthlyAmount));
}
