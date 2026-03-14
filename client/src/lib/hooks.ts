import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";
import { queryClient } from "./queryClient";
import type { User, Wallet, Category, Transaction, RecurringIncome, Obligation, VariableObligationMonthStatus } from "@shared/schema";

type WalletPayload = Pick<Wallet, "name" | "type" | "balance" | "color">;
type WalletUpdatePayload = Partial<WalletPayload> & { id: number };
type CategoryPayload = Pick<Category, "name" | "type" | "icon" | "color" | "budget">;
type TransactionPayload = {
  walletId: number;
  targetWalletId?: number | null;
  categoryId: number | null;
  type: "income" | "expense" | "debt" | "transfer";
  amount: number;
  note: string;
};
type RecurringIncomePayload = Pick<RecurringIncome, "title" | "amount" | "incomeType" | "dayOfMonth" | "walletId" | "categoryId" | "note" | "isActive" | "lastAppliedMonth">;
type RecurringIncomeUpdatePayload = Partial<RecurringIncomePayload> & { id: number };
type ObligationPayload = Omit<Obligation, "id" | "userId" | "createdAt" | "updatedAt">;
type ObligationUpdatePayload = Partial<ObligationPayload> & { id: number };

export type ReportsSummary = {
  period: string;
  summary: {
    totalIncome: number;
    totalExpenses: number;
    netFlow: number;
    savingsRate: number;
    transactionCount: number;
    recurringConfiguredTotal: number;
    salarySourceCount: number;
  };
  expensesByCategory: Array<{
    categoryId: number | null;
    categoryName: string;
    total: number;
    count: number;
  }>;
  walletBreakdown: Array<{
    id: number;
    name: string;
    color: string;
    balance: number;
    income: number;
    expenses: number;
    transactionCount: number;
  }>;
  timeline: Array<{
    label: string;
    income: number;
    expenses: number;
  }>;
  upcomingObligations: Array<{
    id: number;
    title: string;
    amount: number;
    dueDay: number | null;
    dueMonth: number | null;
    dueDate: number | null;
    frequency: string;
  }>;
  recentTransactions: (Transaction & { categoryName?: string | null; categoryIcon?: string | null; walletName?: string | null })[];
  insights: string[];
};

export type AdminUserStats = {
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  newUsersThisMonth: number;
  usersLoggedInToday: number;
};

export type AdminBackupRecord = {
  fileName: string;
  filePath: string;
  frequency: "daily" | "weekly" | "annual" | "manual";
};

export type AdminBackupCollection = {
  daily: AdminBackupRecord[];
  weekly: AdminBackupRecord[];
  annual: AdminBackupRecord[];
  manual: AdminBackupRecord[];
};

export function useUser() {
  return useQuery<User | null>({
    queryKey: ["/api/user"],
    retry: false,
    staleTime: Infinity,
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: () => apiRequest("POST", "/api/logout"),
    onSuccess: () => {
      queryClient.setQueryData(["/api/user"], null);
      queryClient.clear();
    },
  });
}

export function useLogin() {
  return useMutation({
    mutationFn: (data: { username: string; password: string }) =>
      apiRequest("POST", "/api/login", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    },
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: async (data: { username: string; password: string; name: string; email?: string; phone?: string }) => {
      const res = await apiRequest("POST", "/api/register", data);
      return res.json() as Promise<User>;
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/user"], user);
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    },
  });
}

export function useUpdateUser() {
  return useMutation({
    mutationFn: (data: Partial<User>) =>
      apiRequest("PATCH", "/api/user", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      apiRequest("POST", "/api/user/change-password", data),
  });
}

export function useAdminStats() {
  return useQuery<AdminUserStats>({
    queryKey: ["/api/admin/stats"],
  });
}

export function useAdminUsers() {
  return useQuery<Omit<User, "password">[]>({
    queryKey: ["/api/admin/users"],
  });
}

export function useAdminBackups() {
  return useQuery<AdminBackupCollection>({
    queryKey: ["/api/admin/backups"],
  });
}

export function useAdminCreateManualBackup() {
  return useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/backups/manual"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/backups"] });
    },
  });
}

export function useAdminUpdateUser() {
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; isActive: boolean }) =>
      apiRequest("PATCH", `/api/admin/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
    },
  });
}

export function useAdminDeleteUser() {
  return useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
    },
  });
}

export function useDashboard() {
  return useQuery<{
    totalBalance: number;
    totalIncome: number;
    totalExpenses: number;
    recentTransactions: (Transaction & { categoryName?: string; categoryIcon?: string })[];
  }>({
    queryKey: ["/api/dashboard"],
  });
}

export function useWallets() {
  return useQuery<Wallet[]>({
    queryKey: ["/api/wallets"],
  });
}

export function useCreateWallet() {
  return useMutation({
    mutationFn: (data: WalletPayload) => apiRequest("POST", "/api/wallets", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wallets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
  });
}

export function useUpdateWallet() {
  return useMutation({
    mutationFn: ({ id, ...data }: WalletUpdatePayload) => apiRequest("PATCH", `/api/wallets/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wallets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
  });
}

export function useDeleteWallet() {
  return useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/wallets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wallets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
  });
}

export function useCategories() {
  return useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });
}

export function useCreateCategory() {
  return useMutation({
    mutationFn: (data: CategoryPayload) => apiRequest("POST", "/api/categories", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
    },
  });
}

export function useDeleteCategory() {
  return useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/categories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
    },
  });
}

export function useTransactions() {
  return useQuery<(Transaction & { categoryName?: string; categoryIcon?: string; walletName?: string })[]>({
    queryKey: ["/api/transactions"],
  });
}

export function useCreateTransaction() {
  return useMutation({
    mutationFn: (data: TransactionPayload) => apiRequest("POST", "/api/transactions", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wallets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
  });
}

export function useDeleteTransaction() {
  return useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/transactions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wallets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
  });
}

export function useRecurringIncomes() {
  return useQuery<RecurringIncome[]>({
    queryKey: ["/api/recurring-incomes"],
  });
}

export function useCreateRecurringIncome() {
  return useMutation({
    mutationFn: (data: RecurringIncomePayload) => apiRequest("POST", "/api/recurring-incomes", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-incomes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
  });
}

export function useUpdateRecurringIncome() {
  return useMutation({
    mutationFn: ({ id, ...data }: RecurringIncomeUpdatePayload) => apiRequest("PATCH", `/api/recurring-incomes/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-incomes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
  });
}

export function useDeleteRecurringIncome() {
  return useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/recurring-incomes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-incomes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/summary"] });
    },
  });
}

export function useReportsSummary(period: "all" | "1month" | "3months" | "6months" | "1year") {
  return useQuery<ReportsSummary>({
    queryKey: ["/api/reports/summary", period],
    queryFn: async () => {
      const response = await fetch(`/api/reports/summary?period=${period}`, {
        credentials: "include",
      });

      if (!response.ok) {
        const message = (await response.text()) || "ÙØ´Ù„ ØªØ­Ù…ÙŠÙ„ Ø§Ù„ØªÙ‚Ø§Ø±ÙŠØ±";
        throw new Error(message);
      }

      return response.json();
    },
  });
}

// Obligations Hooks
export function useObligations() {
  return useQuery<Obligation[]>({
    queryKey: ["/api/obligations"],
  });
}

export function useObligation(id: number | undefined) {
  return useQuery<Obligation>({
    queryKey: ["/api/obligations", id],
    enabled: !!id,
  });
}

export function useCreateObligation() {
  return useMutation({
    mutationFn: (data: ObligationPayload) => apiRequest("POST", "/api/obligations", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/obligations"] });
    },
  });
}

export function useUpdateObligation() {
  return useMutation({
    mutationFn: ({ id, ...data }: ObligationUpdatePayload) => apiRequest("PATCH", `/api/obligations/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/obligations"] });
    },
  });
}

export function useDeleteObligation() {
  return useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/obligations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/obligations"] });
    },
  });
}

export function useToggleObligation() {
  return useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/obligations/${id}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/obligations"] });
    },
  });
}

export function useVariableObligationStatuses(id: number | undefined) {
  return useQuery<VariableObligationMonthStatus[]>({
    queryKey: ["/api/obligations", id, "variable-statuses"],
    enabled: !!id,
  });
}

export function useUpdateVariableObligationMonthStatus(id: number | undefined) {
  return useMutation({
    mutationFn: (data: { monthKey: string; status: "paid" | "late" | "unpaid"; paidAt?: number | null; note?: string | null }) =>
      apiRequest("PATCH", `/api/obligations/${id}/variable-statuses`, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/obligations"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/obligations", id] });
      await queryClient.invalidateQueries({ queryKey: ["/api/obligations", id, "variable-statuses"] });
    },
  });
}


export type AdminPasswordResetRequest = {
  id: number;
  userId: number;
  status: string;
  verificationMethod: string;
  requestedByIdentifier: string;
  contactValue: string | null;
  adminUserId: number | null;
  createdAt: number;
  resolvedAt: number | null;
  user: {
    id: number;
    name: string;
    username: string;
    email: string;
    phone: string | null;
    isActive: boolean;
  } | null;
};

export type PasswordResetSelfServiceStartResponse = {
  message: string;
  deliveryMethod: "email" | "phone" | null;
  maskedContact: string | null;
  fallbackToAdmin: boolean;
  debugCode?: string;
};

export function useForgotPasswordRequest() {
  return useMutation({
    mutationFn: (data: { identifier: string }) => apiRequest("POST", "/api/password-reset/request", data),
  });
}

export function usePasswordResetSelfServiceStart() {
  return useMutation({
    mutationFn: async (data: { identifier: string }) => {
      const response = await apiRequest("POST", "/api/password-reset/request-token", data);
      return response.json() as Promise<PasswordResetSelfServiceStartResponse>;
    },
  });
}

export function usePasswordResetSelfServiceComplete() {
  return useMutation({
    mutationFn: (data: { token: string; newPassword: string }) =>
      apiRequest("POST", "/api/password-reset/complete", data),
  });
}

export function useAdminPasswordResetRequests() {
  return useQuery<AdminPasswordResetRequest[]>({
    queryKey: ["/api/admin/password-reset-requests"],
  });
}

export function useAdminApprovePasswordReset() {
  return useMutation({
    mutationFn: ({ id, temporaryPassword }: { id: number; temporaryPassword: string }) => apiRequest("POST", `/api/admin/password-reset-requests/${id}/approve`, { temporaryPassword }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/password-reset-requests"] });
    },
  });
}

export function useAdminRejectPasswordReset() {
  return useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/password-reset-requests/${id}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/password-reset-requests"] });
    },
  });
}
