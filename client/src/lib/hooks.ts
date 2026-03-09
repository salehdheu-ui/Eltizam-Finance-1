import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";
import { queryClient } from "./queryClient";
import type { User, Wallet, Category, Transaction, Obligation, VariableObligationMonthStatus } from "@shared/schema";

export type AdminUserStats = {
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  newUsersThisMonth: number;
  usersLoggedInToday: number;
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
    mutationFn: (data: { username: string; password: string; name: string; email: string }) =>
      apiRequest("POST", "/api/register", data),
    onSuccess: () => {
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
    mutationFn: (data: any) => apiRequest("POST", "/api/wallets", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wallets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
  });
}

export function useUpdateWallet() {
  return useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PATCH", `/api/wallets/${id}`, data),
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
    mutationFn: (data: any) => apiRequest("POST", "/api/categories", data),
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
    mutationFn: (data: any) => apiRequest("POST", "/api/transactions", data),
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
    mutationFn: (data: any) => apiRequest("POST", "/api/obligations", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/obligations"] });
    },
  });
}

export function useUpdateObligation() {
  return useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PATCH", `/api/obligations/${id}`, data),
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
