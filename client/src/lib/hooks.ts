import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";
import { queryClient } from "./queryClient";
import type { User, Wallet, Category, Transaction, RecurringIncome, Obligation, VariableObligationMonthStatus, Commitment, CommitmentStep, CommitmentProof, SavingsGoal } from "@shared/schema";

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
type CommitmentPayload = Pick<Commitment, "title" | "type" | "frequency" | "dueDate" | "amount" | "personName" | "assetName" | "notes">;
type CommitmentUpdatePayload = Partial<CommitmentPayload & Pick<Commitment, "progress" | "reminderDaysBefore" | "escalateAfterDays" | "autoCloseOnProof">> & { id: number };
type SavingsGoalPayload = Pick<SavingsGoal, "planId" | "planTitle" | "title" | "walletId" | "targetAmount" | "monthlyAmount" | "years">;

export type OwnedCommitmentShare = {
  id: number;
  status: "pending" | "accepted" | "declined" | "completed" | "approved" | "revoked";
  assignedAt: number;
  respondedAt: number | null;
  completedAt: number | null;
  completionNote: string | null;
  reviewNote: string | null;
  reviewedAt: number | null;
  assigneeName: string;
  assigneeEmail: string;
};

export type SharedCommitment = {
  id: number;
  status: "pending" | "accepted" | "completed" | "approved";
  assignedAt: number;
  respondedAt: number | null;
  completedAt: number | null;
  completionNote: string | null;
  reviewNote: string | null;
  reviewedAt: number | null;
  commitmentId: number;
  title: string;
  type: string;
  dueDate: number | null;
  ownerName: string;
};

export type ManagedCommitmentShare = {
  id: number;
  status: "pending" | "accepted" | "declined" | "completed" | "approved" | "revoked";
  assignedAt: number;
  respondedAt: number | null;
  completedAt: number | null;
  reviewedAt: number | null;
  completionNote: string | null;
  reviewNote: string | null;
  commitmentId: number;
  title: string;
  type: string;
  dueDate: number | null;
  assigneeName: string;
  assigneeEmail: string;
};

export type SharedCommitmentPerson = {
  id: number;
  name: string;
  email: string;
};

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

export type AdminIntegrationProvider = "google" | "microsoft";

export type AdminIntegration = {
  provider: AdminIntegrationProvider;
  label: string;
  configured: boolean;
  source: "database" | "environment" | null;
  hasDatabaseRecord: boolean;
  isEnabled: boolean;
  clientId: string;
  clientSecretMasked: string | null;
  tenantId: string;
  redirectUri: string;
  effectiveRedirectUri: string;
  defaultRedirectUri: string;
  updatedAt: number | null;
};

export type AdminIntegrationPayload = {
  clientId: string;
  clientSecret?: string;
  tenantId?: string | null;
  redirectUri?: string | null;
  isEnabled?: boolean;
};

export type AdminEmailChannel = {
  channel: "email";
  label: string;
  configured: boolean;
  source: "database" | "environment" | null;
  hasDatabaseRecord: boolean;
  isEnabled: boolean;
  updatedAt: number | null;
  host: string;
  port: number;
  secure: boolean;
  requireAuth: boolean;
  user: string;
  from: string;
  passMasked: string | null;
};

export type AdminPushChannel = {
  channel: "push";
  label: string;
  configured: boolean;
  source: "database" | "environment" | null;
  hasDatabaseRecord: boolean;
  isEnabled: boolean;
  updatedAt: number | null;
  publicKey: string;
  subject: string;
  privateKeyMasked: string | null;
};

export type AdminChannels = { email: AdminEmailChannel; push: AdminPushChannel };

export function useAdminChannels() {
  return useQuery<AdminChannels>({ queryKey: ["/api/admin/channels"] });
}

function invalidateChannelQueries() {
  queryClient.invalidateQueries({ queryKey: ["/api/admin/channels"] });
  queryClient.invalidateQueries({ queryKey: ["/api/notifications/preferences"] });
}

export function useAdminSaveEmailChannel() {
  return useMutation({
    mutationFn: (data: {
      host: string; port: number; secure: boolean; requireAuth: boolean;
      user?: string; pass?: string; from?: string; isEnabled?: boolean;
    }) => apiRequest("PUT", "/api/admin/channels/email", data),
    onSuccess: invalidateChannelQueries,
  });
}

export function useAdminSavePushChannel() {
  return useMutation({
    mutationFn: (data: { publicKey: string; privateKey?: string; subject?: string; isEnabled?: boolean }) =>
      apiRequest("PUT", "/api/admin/channels/push", data),
    onSuccess: invalidateChannelQueries,
  });
}

export function useAdminGenerateVapidKeys() {
  return useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/channels/push/generate");
      return response.json() as Promise<{ publicKey: string; privateKey: string }>;
    },
  });
}

export function useAdminDeleteChannel() {
  return useMutation({
    mutationFn: (channel: "email" | "push") => apiRequest("DELETE", `/api/admin/channels/${channel}`),
    onSuccess: invalidateChannelQueries,
  });
}

export function useAdminTestEmailChannel() {
  return useMutation({
    mutationFn: async (to: string) => {
      const response = await apiRequest("POST", "/api/admin/channels/email/test", { to });
      return response.json() as Promise<{ ok: boolean; message: string }>;
    },
  });
}

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

export function useAdminIntegrations() {
  return useQuery<AdminIntegration[]>({
    queryKey: ["/api/admin/integrations"],
  });
}

export function useAdminSaveIntegration() {
  return useMutation({
    mutationFn: ({ provider, ...data }: AdminIntegrationPayload & { provider: AdminIntegrationProvider }) =>
      apiRequest("PUT", `/api/admin/integrations/${provider}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/integrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox"] });
    },
  });
}

export function useAdminDeleteIntegration() {
  return useMutation({
    mutationFn: (provider: AdminIntegrationProvider) =>
      apiRequest("DELETE", `/api/admin/integrations/${provider}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/integrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox"] });
    },
  });
}

export function useAdminTestIntegration() {
  return useMutation({
    mutationFn: async (provider: AdminIntegrationProvider) => {
      const response = await apiRequest("POST", `/api/admin/integrations/${provider}/test`);
      return response.json() as Promise<{ ok: boolean; message: string }>;
    },
  });
}

export function useUpdateTransactionCategory() {
  return useMutation({
    mutationFn: async ({ id, categoryId, applyToAll = true }: { id: number; categoryId: number | null; applyToAll?: boolean }) => {
      const response = await apiRequest("PATCH", `/api/transactions/${id}`, { categoryId, applyToAll });
      return response.json() as Promise<{ id: number; ruleSaved: boolean; ruleLabel: string | null; appliedToOthers: number }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-inbox/analysis"] });
    },
  });
}

export type AutomationLogEntry = {
  id: number;
  action: string;
  summary: string;
  commitmentId: number | null;
  occurrenceId: number | null;
  canUndo: boolean;
  undoneAt: number | null;
  createdAt: number;
};

export type UpcomingOccurrence = {
  id: number;
  commitmentId: number;
  dueDate: number;
  status: string;
  amount: number | null;
  postponedFrom: number | null;
  escalatedAt: number | null;
  title: string;
  type: string;
  delegatedTo: string | null;
};

export function useAutomationLog() {
  return useQuery<AutomationLogEntry[]>({ queryKey: ["/api/automation/log"] });
}

export function useUpcomingOccurrences() {
  return useQuery<UpcomingOccurrence[]>({ queryKey: ["/api/occurrences"] });
}

function invalidateAutomation() {
  queryClient.invalidateQueries({ queryKey: ["/api/automation/log"] });
  queryClient.invalidateQueries({ queryKey: ["/api/occurrences"] });
  queryClient.invalidateQueries({ queryKey: ["/api/commitments"] });
}

export function useRunAutomation() {
  return useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/automation/run");
      return response.json() as Promise<{ occurrences: number; reminders: number; missed: number; escalated: number; closed: number; sharedReminders: number; sharedEscalated: number; weeklySummaries: number }>;
    },
    onSuccess: invalidateAutomation,
  });
}

export function useUndoAutomation() {
  return useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/automation/log/${id}/undo`),
    onSuccess: invalidateAutomation,
  });
}

export function usePostponeOccurrence() {
  return useMutation({
    mutationFn: ({ id, days }: { id: number; days: number }) =>
      apiRequest("POST", `/api/occurrences/${id}/postpone`, { days }),
    onSuccess: invalidateAutomation,
  });
}

export function useSetOccurrenceStatus() {
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: "pending" | "completed" | "missed" | "skipped" }) =>
      apiRequest("PATCH", `/api/occurrences/${id}`, { status }),
    onSuccess: invalidateAutomation,
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
    mutationFn: async (data: CategoryPayload) => {
      const response = await apiRequest("POST", "/api/categories", data);
      return response.json() as Promise<Category>;
    },
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/wallets"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/reports/summary"] });
      await queryClient.refetchQueries({ queryKey: ["/api/dashboard"], type: "active" });
      await queryClient.refetchQueries({ queryKey: ["/api/transactions"], type: "active" });
      await queryClient.refetchQueries({ queryKey: ["/api/reports/summary"], type: "active" });
    },
  });
}

export function useDeleteTransaction() {
  return useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/transactions/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/wallets"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/reports/summary"] });
      await queryClient.refetchQueries({ queryKey: ["/api/dashboard"], type: "active" });
      await queryClient.refetchQueries({ queryKey: ["/api/transactions"], type: "active" });
      await queryClient.refetchQueries({ queryKey: ["/api/reports/summary"], type: "active" });
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
        const message = (await response.text()) || "فشل تحميل التقارير";
        throw new Error(message);
      }

      return response.json();
    },
  });
}




export function useSavingsGoals() {
  return useQuery<SavingsGoal[]>({
    queryKey: ["/api/savings-goals"],
  });
}

export function useCreateSavingsGoal() {
  return useMutation({
    mutationFn: (data: SavingsGoalPayload) => apiRequest("POST", "/api/savings-goals", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/savings-goals"] });
    },
  });
}

export function useDeleteSavingsGoal() {
  return useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/savings-goals/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/savings-goals"] });
    },
  });
}
export function useCommitment(id: number | undefined) {
  return useQuery<Commitment>({
    queryKey: ["/api/commitments", id],
    enabled: !!id,
  });
}

export function useCommitmentSteps(id: number | undefined) {
  return useQuery<CommitmentStep[]>({
    queryKey: ["/api/commitments", id, "steps"],
    enabled: !!id,
  });
}

export function useCreateCommitmentStep(id: number | undefined) {
  return useMutation({
    mutationFn: (data: { title: string; position?: number }) =>
      apiRequest("POST", "/api/commitments/" + id + "/steps", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/commitments", id, "steps"] });
      queryClient.invalidateQueries({ queryKey: ["/api/commitments", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/commitments"] });
    },
  });
}

export function useToggleCommitmentStep(id: number | undefined) {
  return useMutation({
    mutationFn: (stepId: number) => apiRequest("PATCH", "/api/commitments/" + id + "/steps/" + stepId + "/toggle"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/commitments", id, "steps"] });
      queryClient.invalidateQueries({ queryKey: ["/api/commitments", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/commitments"] });
    },
  });
}

export function useDeleteCommitmentStep(id: number | undefined) {
  return useMutation({
    mutationFn: (stepId: number) => apiRequest("DELETE", "/api/commitments/" + id + "/steps/" + stepId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/commitments", id, "steps"] });
      queryClient.invalidateQueries({ queryKey: ["/api/commitments", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/commitments"] });
    },
  });
}

export function useCommitmentProofs(id: number | undefined) {
  return useQuery<CommitmentProof[]>({
    queryKey: ["/api/commitments", id, "proofs"],
    enabled: !!id,
  });
}

export function useCreateCommitmentProof(id: number | undefined) {
  return useMutation({
    mutationFn: (data: { kind: "note" | "link" | "file" | "receipt"; label: string; value: string }) =>
      apiRequest("POST", "/api/commitments/" + id + "/proofs", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/commitments", id, "proofs"] });
    },
  });
}

export function useDeleteCommitmentProof(id: number | undefined) {
  return useMutation({
    mutationFn: (proofId: number) => apiRequest("DELETE", "/api/commitments/" + id + "/proofs/" + proofId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/commitments", id, "proofs"] });
    },
  });
}
export function useCommitments() {
  return useQuery<Commitment[]>({
    queryKey: ["/api/commitments"],
  });
}

export function useCreateCommitment() {
  return useMutation({
    mutationFn: async (data: CommitmentPayload) => {
      const response = await apiRequest("POST", "/api/commitments", data);
      return response.json() as Promise<Commitment>;
    },
    onSuccess: (created) => {
      queryClient.setQueryData<Commitment[]>(["/api/commitments"], (current = []) => [
        created,
        ...current.filter((commitment) => commitment.id !== created.id),
      ]);
      queryClient.invalidateQueries({ queryKey: ["/api/commitments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/occurrences"] });
    },
  });
}

export function useUpdateCommitment() {
  return useMutation({
    mutationFn: ({ id, ...data }: CommitmentUpdatePayload) => apiRequest("PATCH", `/api/commitments/${id}`, data),
    onSuccess: (_response, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/commitments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/commitments", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/occurrences"] });
    },
  });
}

export function useUpdateCommitmentStatus() {
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: Commitment["status"] }) =>
      apiRequest("PATCH", `/api/commitments/${id}/status`, { status }),
    onSuccess: (_response, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/commitments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/commitments", variables.id] });
    },
  });
}

export function useDeleteCommitment() {
  return useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/commitments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/commitments"] });
    },
  });
}

export function useCommitmentShares(id: number | undefined) {
  return useQuery<OwnedCommitmentShare[]>({
    queryKey: ["/api/commitments", id, "shares"],
    enabled: !!id,
  });
}

function invalidateSharedCommitmentQueries(id?: number) {
  if (id) queryClient.invalidateQueries({ queryKey: ["/api/commitments", id, "shares"] });
  queryClient.invalidateQueries({ queryKey: ["/api/shared-commitments"] });
  queryClient.invalidateQueries({ queryKey: ["/api/shared-commitments/managed"] });
  queryClient.invalidateQueries({ queryKey: ["/api/shared-commitments/people"] });
}

export function useCreateCommitmentShare(id: number | undefined) {
  return useMutation({
    mutationFn: (email: string) => apiRequest("POST", `/api/commitments/${id}/shares`, { email }),
    onSuccess: () => invalidateSharedCommitmentQueries(id),
  });
}

export function useRevokeCommitmentShare(commitmentId: number | undefined) {
  return useMutation({
    mutationFn: (shareId: number) => apiRequest("PATCH", `/api/commitments/${commitmentId}/shares/${shareId}/revoke`),
    onSuccess: () => invalidateSharedCommitmentQueries(commitmentId),
  });
}

export function useReviewCommitmentShare(commitmentId: number | undefined) {
  return useMutation({
    mutationFn: ({ shareId, action, reviewNote }: { shareId: number; action: "approve" | "rework"; reviewNote?: string }) =>
      apiRequest("PATCH", `/api/commitments/${commitmentId}/shares/${shareId}/review`, { action, reviewNote }),
    onSuccess: () => invalidateSharedCommitmentQueries(commitmentId),
  });
}

export function useSharedCommitments() {
  return useQuery<SharedCommitment[]>({ queryKey: ["/api/shared-commitments"] });
}

export function useManagedCommitmentShares() {
  return useQuery<ManagedCommitmentShare[]>({ queryKey: ["/api/shared-commitments/managed"] });
}

export function useSharedCommitmentPeople() {
  return useQuery<SharedCommitmentPerson[]>({ queryKey: ["/api/shared-commitments/people"] });
}

export function useRespondToCommitmentShare() {
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: "accepted" | "declined" }) =>
      apiRequest("PATCH", `/api/shared-commitments/${id}/respond`, { status }),
    onSuccess: () => invalidateSharedCommitmentQueries(),
  });
}

export function useCompleteSharedCommitment() {
  return useMutation({
    mutationFn: ({ id, completionNote }: { id: number; completionNote?: string }) =>
      apiRequest("PATCH", `/api/shared-commitments/${id}/complete`, { completionNote }),
    onSuccess: () => invalidateSharedCommitmentQueries(),
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
