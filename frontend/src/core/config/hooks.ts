/**
 * React Query hooks for Community Tools config.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  loadToolProviders,
  loadToolsConfig,
  saveToolsConfig,
  ConfigToolsRequestError,
} from "./api";

/** Fetch the current tools configuration. */
export function useToolsConfig() {
  return useQuery({
    queryKey: ["toolsConfig"],
    queryFn: () => loadToolsConfig(),
    retry: (count, error) =>
      !(error instanceof ConfigToolsRequestError) && count < 3,
  });
}

/** Fetch the registry of available community tool providers. */
export function useToolProviders() {
  return useQuery({
    queryKey: ["toolProviders"],
    queryFn: () => loadToolProviders(),
    staleTime: Infinity, // provider list is static
  });
}

/** Save the tools configuration. */
export function useSaveToolsConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tools: Parameters<typeof saveToolsConfig>[0]) => saveToolsConfig(tools),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["toolsConfig"] });
    },
  });
}
