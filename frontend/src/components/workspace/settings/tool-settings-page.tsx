"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircleIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  TrashIcon,
  XCircleIcon,
  ZapIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { testMCPConnection } from "@/core/mcp/api";
import { useMCPConfig } from "@/core/mcp/hooks";
import { env } from "@/env";

import { SettingsSection } from "./settings-section";

type TestState = "idle" | "testing" | "connected" | "failed";

export function ToolSettingsPage() {
  const { t } = useI18n();
  const { config, isLoading } = useMCPConfig();
  const queryClient = useQueryClient();
  const [newJson, setNewJson] = useState("");
  const [saving, setSaving] = useState(false);

  const servers = config?.mcpServers ?? config?.mcp_servers ?? {};
  const serverEntries = Object.entries(servers);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["mcpConfig"] });
  };

  const saveServers = async (updated: Record<string, unknown>) => {
    const res = await fetch(`${getBackendBaseURL()}/api/mcp/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mcpServers: updated }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    invalidate();
  };

  const handleToggle = (name: string, enabled: boolean) => {
    const updated = { ...servers, [name]: { ...servers[name], enabled } };
    saveServers(updated).catch(() => toast.error("保存失败"));
  };

  const handleDelete = (name: string) => {
    const updated = { ...servers };
    delete updated[name];
    saveServers(updated).then(() => toast.success("已删除")).catch(() => toast.error("删除失败"));
  };

  const handleSaveEdit = (name: string, newCfg: Record<string, unknown>) => {
    const updated = { ...servers, [name]: newCfg };
    saveServers(updated).then(() => toast.success("已保存")).catch(() => toast.error("保存失败"));
  };

  const handleAddFromJson = async () => {
    let parsed: { mcpServers?: Record<string, Record<string, unknown>> };
    try {
      parsed = JSON.parse(newJson);
      if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
        throw new Error("缺少 mcpServers 字段");
      }
    } catch (err) {
      toast.error(`JSON 格式错误: ${err instanceof Error ? err.message : "未知"}`);
      return;
    }
    setSaving(true);
    try {
      const tested: Record<string, Record<string, unknown>> = {};
      for (const [name, cfg] of Object.entries(parsed.mcpServers)) {
        const res = await testMCPConnection(cfg);
        if (res.connected) {
          tested[name] = { ...cfg, enabled: true };
          toast.success(`${name} 连接成功，${res.toolCount ?? 0} 个工具可用`);
        } else {
          tested[name] = { ...cfg, enabled: false };
          toast.error(`${name} 连接失败，已禁用保存: ${res.error ?? "未知错误"}`);
        }
      }
      const merged = { ...servers, ...tested };
      await saveServers(merged);
      setNewJson("");
    } catch (err) {
      toast.error(`添加失败: ${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      title={t.settings.tools.title}
      description={t.settings.tools.description}
    >
      {/* 外链 */}
      <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3">
        <ExternalLinkIcon className="size-4 shrink-0 text-blue-500" />
        <span className="text-sm">发现更多 MCP 服务器</span>
        <a
          href="https://cloud.tencent.com/developer/mcp"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline dark:text-blue-400 ml-auto text-sm font-medium"
        >
          腾讯云 MCP 广场 →
        </a>
      </div>

      {/* 已配置服务器卡片 */}
      {isLoading ? (
        <div className="text-muted-foreground py-8 text-sm">{t.common.loading}</div>
      ) : serverEntries.length === 0 ? (
        <div className="text-muted-foreground mb-6 py-8 text-center text-sm">
          {t.settings.tools.empty}
        </div>
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          {serverEntries.map(([name, cfg]) => (
            <MCPCard
              key={name}
              name={name}
              config={cfg as Record<string, unknown>}
              onToggle={(enabled) => handleToggle(name, enabled)}
              onDelete={() => handleDelete(name)}
              onSaveEdit={(newCfg) => handleSaveEdit(name, newCfg)}
            />
          ))}
        </div>
      )}

      {/* JSON 添加区 */}
      <div className="rounded-lg border border-dashed p-4">
        <div className="mb-2 flex items-center gap-2">
          <PlusIcon className="size-4" />
          <span className="text-sm font-medium">通过 JSON 添加</span>
        </div>
        <p className="text-muted-foreground mb-3 text-xs">
          粘贴标准 MCP 配置，合并到已有配置
        </p>
        <textarea
          className="mb-3 w-full rounded-lg border bg-muted/30 p-3 font-mono text-sm"
          rows={8}
          placeholder={'{\n  "mcpServers": {\n    "deepwiki": {\n      "url": "https://mcp.deepwiki.com/mcp"\n    }\n  }\n}'}
          value={newJson}
          onChange={(e) => setNewJson(e.target.value)}
          spellCheck={false}
        />
        <Button size="sm" onClick={handleAddFromJson} disabled={saving || !newJson.trim()}>
          <SaveIcon className="mr-1.5 size-4" />
          {saving ? "添加中..." : "添加"}
        </Button>
      </div>
    </SettingsSection>
  );
}

function MCPCard({
  name,
  config,
  onToggle,
  onDelete,
  onSaveEdit,
}: {
  name: string;
  config: Record<string, unknown>;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  onSaveEdit: (newCfg: Record<string, unknown>) => void;
}) {
  const transport = String(
    (config.type as string) ??
    (config.transport as string) ??
    (config.url ? "http" : "stdio"),
  );
  const enabled = config.enabled !== false;
  const [editing, setEditing] = useState(false);
  const [testState, setTestState] = useState<TestState>("idle");
  const [toolCount, setToolCount] = useState<number | null>(null);

  // Edit form state
  const [editDesc, setEditDesc] = useState(String((config.description as string) ?? ""));
  const [editCommand, setEditCommand] = useState(String((config.command as string) ?? ""));
  const [editArgs, setEditArgs] = useState(
    Array.isArray(config.args) ? (config.args as string[]).join("\n") : "",
  );
  const [editUrl, setEditUrl] = useState(String((config.url as string) ?? ""));
  const [editEnv, setEditEnv] = useState(
    config.env && typeof config.env === "object"
      ? Object.entries(config.env).map(([k, v]) => `${k}=${v}`).join("\n")
      : "",
  );

  const runTest = async (): Promise<boolean> => {
    setTestState("testing");
    try {
      const data = await testMCPConnection(config);
      setTestState(data.connected ? "connected" : "failed");
      setToolCount(data.toolCount ?? null);
      if (!data.connected) {
        toast.error(`连接失败: ${data.error ?? "无法连接到 MCP 服务器"}`);
      }
      return data.connected;
    } catch (err) {
      setTestState("failed");
      toast.error(`连接失败: ${err instanceof Error ? err.message : "未知错误"}`);
      return false;
    }
  };

  const handleToggleWithTest = async (enabled: boolean) => {
    if (!enabled) {
      onToggle(false);
      return;
    }
    const ok = await runTest();
    if (ok) {
      onToggle(true);
    }
  };

  const handleSaveEditForm = () => {
    const newCfg: Record<string, unknown> = {
      ...config,
      enabled,
      description: editDesc.trim(),
    };
    if (transport === "stdio") {
      newCfg.command = editCommand.trim();
      newCfg.args = editArgs.split("\n").map((a) => a.trim()).filter(Boolean);
      const envObj: Record<string, string> = {};
      for (const line of editEnv.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf("=");
        if (eq > 0) envObj[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
      }
      newCfg.env = envObj;
    } else {
      newCfg.url = editUrl.trim();
    }
    onSaveEdit(newCfg);
    setEditing(false);
  };

  return (
    <div className="rounded-lg border p-4">
      {/* Header row */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{name}</span>
            <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs uppercase">
              {transport}
            </span>
            {/* Status indicator */}
            {testState === "connected" && (
              <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <CheckCircleIcon className="size-3.5" />
                {toolCount !== null ? `${toolCount} 工具` : "已连接"}
              </span>
            )}
            {testState === "failed" && (
              <span className="flex items-center gap-1 text-xs text-red-500">
                <XCircleIcon className="size-3.5" />
                连接失败
              </span>
            )}
            {testState === "testing" && (
              <span className="flex items-center gap-1 text-xs text-yellow-500">
                <Loader2Icon className="size-3.5 animate-spin" />
                检测中
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Info (non-editing) */}
      {!editing && (
        <>
          {typeof config.description === "string" && config.description && (
            <p className="text-muted-foreground mb-1 line-clamp-2 text-xs">{config.description}</p>
          )}
          {typeof config.command === "string" && config.command && (
            <code className="text-muted-foreground mb-1 block truncate text-xs">
              {config.command} {Array.isArray(config.args) ? (config.args as string[]).join(" ") : ""}
            </code>
          )}
          {typeof config.url === "string" && config.url && (
            <code className="text-muted-foreground mb-1 block truncate text-xs">{config.url}</code>
          )}
          {/* Actions */}
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch
                checked={enabled}
                disabled={env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"}
                onCheckedChange={handleToggleWithTest}
              />
              <Button variant="ghost" size="sm" onClick={runTest} disabled={testState === "testing"}>
                <ZapIcon className="mr-1 size-3.5" />
                检测
              </Button>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                <PencilIcon className="mr-1 size-3.5" />
                编辑
              </Button>
              <Button variant="ghost" size="icon-sm" className="text-red-500 hover:text-red-600" onClick={onDelete}>
                <TrashIcon className="size-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Edit form */}
      {editing && (
        <div className="mt-2 space-y-3">
          <EditField label="描述" value={editDesc} onChange={setEditDesc} />
          {transport === "stdio" ? (
            <>
              <EditField label="命令" value={editCommand} onChange={setEditCommand} />
              <EditField label="参数（每行一个）" value={editArgs} onChange={setEditArgs} multiline />
              <EditField label="环境变量（KEY=VALUE）" value={editEnv} onChange={setEditEnv} multiline />
            </>
          ) : (
            <EditField label="URL" value={editUrl} onChange={setEditUrl} />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>取消</Button>
            <Button size="sm" onClick={handleSaveEditForm}>
              <SaveIcon className="mr-1 size-3.5" />
              保存
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium">{label}</label>
      {multiline ? (
        <textarea
          className="w-full rounded-md border bg-muted/30 p-2 font-mono text-xs"
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <input
          className="w-full rounded-md border bg-muted/30 p-2 text-xs"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      )}
    </div>
  );
}
