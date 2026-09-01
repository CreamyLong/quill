"use client";

import { CheckCircleIcon, PlusIcon, RefreshCwIcon, SaveIcon, TrashIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";

interface ModelEntry {
  name: string;
  display_name?: string;
  use: string;
  model: string;
  base_url?: string;
  api_key?: string;
  supports_thinking?: boolean;
  supports_vision?: boolean;
}

interface OllamaModel {
  name: string;
  size?: number;
  parameter_size?: string;
  quantization?: string;
}

export function ModelsSettingsPage() {
  const { t } = useI18n();
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [ollamaLoading, setOllamaLoading] = useState(false);
  const [selectedOllamaModel, setSelectedOllamaModel] = useState("");

  // Load configured models on mount.
  useEffect(() => {
    fetch(`${getBackendBaseURL()}/api/models`)
      .then((r) => r.json())
      .then((data) => {
        if (data.models) {
          setModels(data.models);
        }
      })
      .catch(() => toast.error("Failed to load models"))
      .finally(() => setLoading(false));
  }, []);

  // Fetch local Ollama models.
  const fetchOllamaModels = async () => {
    setOllamaLoading(true);
    try {
      const res = await fetch(`${getBackendBaseURL()}/ollama/models`);
      const data = await res.json();
      if (data.models) {
        setOllamaModels(data.models);
        if (data.models.length > 0) {
          setSelectedOllamaModel(data.models[0].name);
        }
      } else if (data.error) {
        toast.error(data.error);
      }
    } catch {
      toast.error("Failed to fetch Ollama models");
    } finally {
      setOllamaLoading(false);
    }
  };

  // Fetch Ollama models on mount.
  useEffect(() => {
    fetchOllamaModels();
  }, []);

  const handleAddFromOllama = () => {
    if (!selectedOllamaModel) {
      toast.error("Please select a model");
      return;
    }
    // Check if already added.
    if (models.some((m) => m.model === selectedOllamaModel)) {
      toast.error("Model already added");
      return;
    }
    const newModel: ModelEntry = {
      name: selectedOllamaModel.replace(/[:/]/g, "-").toLowerCase(),
      display_name: selectedOllamaModel,
      use: "langchain_ollama:ChatOllama",
      model: selectedOllamaModel,
      base_url: "http://localhost:11434",
      api_key: "ollama",
    };
    setModels([...models, newModel]);
  };

  const handleRemoveModel = (index: number) => {
    setModels(models.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${getBackendBaseURL()}/api/models`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Models saved. Restart Gateway to apply.");
    } catch {
      toast.error("Failed to save models");
    } finally {
      setSaving(false);
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return "";
    const gb = bytes / (1024 * 1024 * 1024);
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">LLM Models</h3>
        <p className="text-sm text-muted-foreground">
          Configure available LLM models. Changes require a Gateway restart.
        </p>
      </div>

      {/* Ollama local models */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium">Local Ollama Models</h4>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchOllamaModels}
            disabled={ollamaLoading}
          >
            <RefreshCwIcon size={14} className={ollamaLoading ? "animate-spin" : ""} />
            <span className="ml-1.5">Refresh</span>
          </Button>
        </div>

        {ollamaModels.length > 0 ? (
          <div className="flex items-center gap-2">
            <select
              className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
              value={selectedOllamaModel}
              onChange={(e) => setSelectedOllamaModel(e.target.value)}
            >
              {ollamaModels.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                  {m.parameter_size ? ` (${m.parameter_size}` : ""}
                  {m.quantization ? ` ${m.quantization})` : m.parameter_size ? ")" : ""}
                  {m.size ? ` — ${formatSize(m.size)}` : ""}
                </option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={handleAddFromOllama}>
              <PlusIcon size={14} />
              <span className="ml-1.5">Add</span>
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {ollamaLoading
              ? "Fetching..."
              : "No Ollama models found. Make sure Ollama is running and has models installed."}
          </p>
        )}

        {ollamaModels.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {ollamaModels.map((m) => {
              const added = models.some((cfg) => cfg.model === m.name);
              return (
                <button
                  key={m.name}
                  type="button"
                  onClick={() => {
                    setSelectedOllamaModel(m.name);
                    if (!added) handleAddFromOllama();
                  }}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    added
                      ? "border-green-500/30 bg-green-500/10 text-green-700"
                      : "border-border hover:border-violet-500/40 hover:bg-violet-500/5"
                  }`}
                  title={m.name}
                >
                  {added && <CheckCircleIcon size={10} />}
                  <span className="max-w-[200px] truncate">{m.name}</span>
                  {m.parameter_size && (
                    <span className="text-muted-foreground">{m.parameter_size}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Configured models */}
      {models.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-medium">Configured Models</h4>
          {models.map((m, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div>
                <div className="font-medium">{m.display_name || m.name}</div>
                <div className="text-xs text-muted-foreground">
                  {m.use} → {m.model}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => handleRemoveModel(i)}
              >
                <TrashIcon size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Save */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          <SaveIcon size={14} className="mr-1.5" />
          {saving ? "Saving..." : "Save Models"}
        </Button>
      </div>
    </div>
  );
}
