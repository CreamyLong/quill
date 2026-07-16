"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRightIcon,
  PlusIcon,
  SparklesIcon,
  UploadIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  Item,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/core/i18n/hooks";
import { installSkill } from "@/core/skills/api";
import { useEnableSkill, useSkills } from "@/core/skills/hooks";

import { SettingsSection } from "./settings-section";

type FilterTab = "all" | "public" | "custom";

export function SkillSettingsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterTab>("all");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { skills, isLoading } = useSkills();
  const { mutate: enableSkill } = useEnableSkill();

  const filtered = useMemo(() => {
    if (filter === "public") return skills.filter((s) => s.category === "public");
    if (filter === "custom") return skills.filter((s) => s.category === "custom");
    return skills;
  }, [skills, filter]);

  const handleUse = (skillName: string) => {
    router.push(`/workspace/chats/new?skill=${encodeURIComponent(skillName)}`);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await installSkill(file);
      if (result.success) {
        toast.success(`技能 "${result.skill_name}" 已安装并启用`);
        void queryClient.invalidateQueries({ queryKey: ["skills"] });
      } else {
        toast.error(result.message || "上传失败");
      }
    } catch {
      toast.error("上传失败，请检查文件格式");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <SettingsSection
      title={t.settings.skills.title}
      description={t.settings.skills.description}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,.skill,.tar.gz"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterTab)}>
          <TabsList>
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="public">公共</TabsTrigger>
            <TabsTrigger value="custom">自定义</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleUploadClick}
            disabled={uploading}
          >
            <UploadIcon className="mr-1.5 size-4" />
            {uploading ? "上传中..." : "上传技能"}
          </Button>
          <Button variant="default" size="sm" asChild>
            <Link href="/workspace/chats/new?mode=skill">
              <PlusIcon className="mr-1.5 size-4" />
              {t.settings.skills.createSkill}
            </Link>
          </Button>
        </div>
      </div>

      {/* Skill grid */}
      {isLoading ? (
        <div className="text-muted-foreground py-8 text-sm">
          {t.common.loading}
        </div>
      ) : filtered.length === 0 ? (
        <Empty className="border-dashed">
          <EmptyMedia variant="icon">
            <SparklesIcon />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>{t.settings.skills.emptyTitle}</EmptyTitle>
            <EmptyDescription>
              {t.settings.skills.emptyDescription}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={handleUploadClick}>
              <UploadIcon className="mr-1.5 size-4" />
              上传技能
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((skill) => (
            <Item
              key={skill.name}
              variant="outline"
              className="flex-col items-start gap-3 p-4"
            >
              <div className="flex w-full items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <ItemTitle className="flex items-center gap-2">
                    <span className="truncate">{skill.name}</span>
                    <span
                      className={
                        skill.category === "public"
                          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0 rounded-full px-2 py-0.5 text-xs"
                          : "bg-violet-500/10 text-violet-600 dark:text-violet-400 shrink-0 rounded-full px-2 py-0.5 text-xs"
                      }
                    >
                      {skill.category === "public" ? "公共" : "自定义"}
                    </span>
                  </ItemTitle>
                  <ItemDescription className="line-clamp-2 mt-1 text-xs">
                    {skill.description ?? "暂无描述"}
                  </ItemDescription>
                </div>
              </div>
              <div className="flex w-full items-center justify-between gap-2">
                <Switch
                  checked={skill.enabled}
                  onCheckedChange={(checked) =>
                    enableSkill({ skillName: skill.name, enabled: checked })
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleUse(skill.name)}
                >
                  <ArrowUpRightIcon className="mr-1 size-3.5" />
                  使用
                </Button>
              </div>
            </Item>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
