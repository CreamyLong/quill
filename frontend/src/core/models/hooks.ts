import { useQuery } from "@tanstack/react-query";

import { loadModels, loadProviders } from "./api";
import type { Model, ProviderPlugin } from "./types";

export function useModels({ enabled = true }: { enabled?: boolean } = {}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["models"],
    queryFn: () => loadModels(),
    enabled,
    refetchOnWindowFocus: false,
  });
  return {
    models: data?.models ?? [],
    tokenUsageEnabled: data?.token_usage.enabled ?? false,
    isLoading,
    error,
  };
}

export function useProviders({ enabled = true }: { enabled?: boolean } = {}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["model-providers"],
    queryFn: () => loadProviders(),
    enabled,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
  return {
    providers: data?.providers ?? [],
    isLoading,
    error,
  };
}

/**
 * Find a provider by class path (the `use` field in model config).
 */
export function findProviderByClassPath(
  providers: ProviderPlugin[],
  classPath: string,
): ProviderPlugin | undefined {
  return providers.find((p) => p.class_path === classPath);
}

/**
 * Infer the provider id from a model's `use` field.
 */
export function inferModelProvider(model: Model): string {
  const parts = model.use.split(":");
  const module = parts[0] ?? "";
  // Extract provider from module name (e.g. "langchain_openai" -> "openai").
  const segments = module.split("_");
  return segments[segments.length - 1] ?? module;
}
