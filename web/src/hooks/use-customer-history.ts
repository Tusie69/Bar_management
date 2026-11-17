import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  AnonymousVisitQuery,
  AssignAnonymousVisitInput,
  AssignmentUndo,
  DuplicateDecisionInput,
} from "@/domain/models"
import { api } from "@/services"

export function useAnonymousVisits(query: AnonymousVisitQuery) {
  return useQuery({ queryKey: ["anonymous-visits", query], queryFn: () => api.getAnonymousVisits(query), retry: false })
}
export function useDuplicateCustomers(query: { page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ["duplicate-customers", query],
    queryFn: () => api.getDuplicateCustomers(query),
    retry: false,
  })
}
function useHistoryInvalidation() {
  const client = useQueryClient()
  return () =>
    Promise.all(
      [
        "anonymous-visits",
        "duplicate-customers",
        "table-turns",
        "table-turn-summary",
        "customers",
        "customer",
        "visits",
        "reservations",
        "waitlist",
        "floor",
        "overview",
      ].map((key) => client.invalidateQueries({ queryKey: [key] })),
    )
}
export function useAssignAnonymousVisit() {
  return useMutation({
    mutationFn: (input: AssignAnonymousVisitInput) => api.assignAnonymousVisit(input),
    onSuccess: useHistoryInvalidation(),
    retry: false,
  })
}
export function useUndoAnonymousAssignment() {
  return useMutation({
    mutationFn: (input: AssignmentUndo) => api.undoAnonymousAssignment(input),
    onSuccess: useHistoryInvalidation(),
    retry: false,
  })
}
export function useMergeDuplicateCustomers() {
  return useMutation({
    mutationFn: (input: DuplicateDecisionInput) => api.mergeDuplicateCustomers(input),
    onSuccess: useHistoryInvalidation(),
    retry: false,
  })
}
export function useDismissDuplicateCustomers() {
  return useMutation({
    mutationFn: (input: DuplicateDecisionInput) => api.dismissDuplicateCustomers(input),
    onSuccess: useHistoryInvalidation(),
    retry: false,
  })
}
