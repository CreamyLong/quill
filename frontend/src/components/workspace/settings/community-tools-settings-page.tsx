"use client";

import { Loader2Icon, SaveIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/core/i18n/hooks";

import type { CommunityToolProvider, ToolConfigEntry } from "@/core/config/api";
import { useSaveToolsConfig, useToolProviders, useToolsConfig } from "@/core/config/hooks";

import { SettingsSection } from "./settings-section";

export function CommunityToolsSettingsPage() {
  const { t } = useI18n();
  const { data: tools, isLoading: toolsLoading } = useToolsConfig();
  const { data: providers, isLoading: providersLoading } = useToolProviders();
  const saveMutation = useSaveToolsConfig();

  const [editingTools, setEditingTools] = useState<ToolConfigEntry[]>([]);
  const [dirty, setDirty] = useState(false);

  const isLoading = toolsLoading || providersLoading;

  // Sync editing state when tools load
  if (tools && !dirty && editingTools.length === 0 && tools.length > 0) {
    setEditingTools(tools.map((tool) => ({ ...tool })));
  }

  const providerMap = new Map<string, CommunityToolProvider>();
  for (const p of providers ?? []) {
    providerMap.set(p.use, p);
  }

  const getProviderInfo = (use: string): CommunityToolProvider | undefined => {
    if (providerMap.has(use)) return providerMap.get(use);
    // Fallback: match by provider id prefix (e.g. "quill.community.tavily.tools:webSearchTool")
    const match = use.match(/community\.([^.]+)\.tools/);
    if (match) {
      for (const p of providers ?? []) {
        if (p.id === match[1]) return p;
      }
    }
    return undefined;
  };

  const handleFieldChange = (index: number, key: string, value: string) => {
    setEditingTools((prev) => {
      const next: ToolConfigEntry[] = [...prev];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
    setDirty(true);
  };

  const handleToggle = (index: number, enabled: boolean) => {
    setEditingTools((prev) => {
      const next: ToolConfigEntry[] = [...prev];
      next[index] = { ...next[index], enabled };
      return next;
    });
    setDirty(true);
  };

  const handleSelectProvider = (index: number, use: string) => {
    const provider = providerMap.get(use);
    if (!provider) return;
    setEditingTools((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        use,
        name: provider.id,
        group: provider.group,
      };
      return next;
    });
    setDirty(true);
  };

  const handleSave = async () => {
    try {
      const result = await saveMutation.mutateAsync(editingTools);
      setDirty(false);
      toast.success(result.message ?? t.settings.communityTools.saveSuccess);
    } catch (err) {
      const message = err instanceof Error ? err.message : t.settings.communityTools.saveFailed;
      toast.error(message);
    }
  };

  return (
    <SettingsSection
      title={t.settings.communityTools.title}
      description={t.settings.communityTools.description}
    >
      {isLoading ? (
        <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
          <Loader2Icon className="size-4 animate-spin" />
          {t.common.loading}
        </div>
      ) : editingTools.length === 0 ? (
        <div className="text-muted-foreground py-8 text-center text-sm">
          {t.settings.communityTools.empty}
        </div>
      ) : (
        <div className="space-y-3">
          {editingTools.map((tool, index) => {
            const provider = getProviderInfo(tool.use);
            const enabled = tool.enabled !== false;
            return (
              <div key={`${tool.name}-${index}`} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {provider?.displayName ?? tool.name}
                      </span>
                      <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs">
                        {tool.use.split(":")[1] ?? tool.use}
                      </span>
                    </div>
                    {provider?.id && (
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {t.settings.communityTools.useLabel}: {tool.use}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(checked) => handleToggle(index, checked)}
                  />
                </div>

                {/* Config fields */}
                {provider && provider.fields.length > 0 && enabled && (
                  <div className="mt-3 space-y-3 border-t pt-3">
                    {provider.fields.map((field) => (
                      <div key={field.key} className="space-y-1">
                        <label className="text-xs font-medium">{field.label}</label>
                        <Input
                          type={field.type === "password" ? "password" : "text"}
                          placeholder={field.placeholder}
                          value={String((tool as Record<string, unknown>)[field.key] ?? "")}
                          onChange={(e) => handleFieldChange(index, field.key, e.target.value)}
                          className="h-8 text-xs"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Save button */}
      {editingTools.length > 0 && (
        <div className="mt-4 flex justify-end">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty || saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2Icon className="mr-1.5 size-4 animate-spin" />
            ) : (
              <SaveIcon className="mr-1.5 size-4" />
            )}
            {t.common.save}
          </Button>
        </div>
      )}

      {/* Restart notice */}
      {dirty && (
        <p className="text-muted-foreground mt-2 text-right text-xs">
          {t.settings.communityTools.restartNotice}
        </p>
      )}
    </SettingsSection>
  );
}
