import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { loadMCPConfig, MCPConfigRequestError, updateMCPConfig } from "./api";

export function useMCPConfig() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["mcpConfig"],
    queryFn: () => loadMCPConfig(),
    retry: (count, error) =>
      !(error instanceof MCPConfigRequestError) && count < 3,
  });
  return { config: data, isLoading, error };
}

export function useEnableMCPServer() {
  const queryClient = useQueryClient();
  const { config } = useMCPConfig();
  return useMutation({
    mutationFn: async ({
      serverName,
      enabled,
    }: {
      serverName: string;
      enabled: boolean;
    }) => {
      if (!config) {
        throw new Error("MCP config not found");
      }
      const servers = config.mcpServers ?? config.mcp_servers ?? {};
      if (!servers[serverName]) {
        throw new Error(`MCP server ${serverName} not found`);
      }
      // Send the full mcpServers map; backend merges per-server.
      const updated = {
        ...servers,
        [serverName]: { ...servers[serverName], enabled },
      };
      await updateMCPConfig({ mcpServers: updated });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcpConfig"] });
    },
  });
}