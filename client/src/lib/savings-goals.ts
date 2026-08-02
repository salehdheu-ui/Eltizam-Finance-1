import type { SavingsGoal } from "@shared/schema";


export type SavingsGoalWalletLike = {
  id: number;
  name: string;
  balance: number;
};

export function getSavingsGoalWalletBalance(goal: SavingsGoal, wallets: SavingsGoalWalletLike[]) {
  const wallet = wallets.find((item) => item.id === goal.walletId);
  return wallet?.balance ?? 0;
}

export function calculateSavingsGoalSavedAmount(goal: SavingsGoal, wallets: SavingsGoalWalletLike[]) {
  return Math.max(0, getSavingsGoalWalletBalance(goal, wallets));
}

export function calculateSavingsGoalProgress(goal: SavingsGoal, wallets: SavingsGoalWalletLike[]) {
  if (goal.targetAmount <= 0) {
    return 0;
  }

  const savedAmount = calculateSavingsGoalSavedAmount(goal, wallets);
  return Math.min((savedAmount / goal.targetAmount) * 100, 100);
}

export function calculateSavingsGoalRemaining(goal: SavingsGoal, wallets: SavingsGoalWalletLike[]) {
  return Math.max(0, goal.targetAmount - calculateSavingsGoalSavedAmount(goal, wallets));
}

export function calculateSavingsGoalMonths(goal: SavingsGoal) {
  if (goal.monthlyAmount <= 0) {
    return null;
  }

  return Math.max(1, Math.ceil(goal.targetAmount / goal.monthlyAmount));
}
