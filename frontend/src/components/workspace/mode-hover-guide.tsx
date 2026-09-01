"use client";

import { useI18n } from "@/core/i18n/hooks";
import type { Translations } from "@/core/i18n/locales/types";

import { Tooltip } from "./tooltip";

export type AgentMode = "swift" | "reflect" | "architect" | "swarm";

function getModeLabelKey(
  mode: AgentMode,
): keyof Pick<
  Translations["inputBox"],
  "swiftMode" | "reflectMode" | "architectMode" | "swarmMode"
> {
  switch (mode) {
    case "swift":
      return "swiftMode";
    case "reflect":
      return "reflectMode";
    case "architect":
      return "architectMode";
    case "swarm":
      return "swarmMode";
  }
}

function getModeDescriptionKey(
  mode: AgentMode,
): keyof Pick<
  Translations["inputBox"],
  | "swiftModeDescription"
  | "reflectModeDescription"
  | "architectModeDescription"
  | "swarmModeDescription"
> {
  switch (mode) {
    case "swift":
      return "swiftModeDescription";
    case "reflect":
      return "reflectModeDescription";
    case "architect":
      return "architectModeDescription";
    case "swarm":
      return "swarmModeDescription";
  }
}

export function ModeHoverGuide({
  mode,
  children,
  showTitle = true,
}: {
  mode: AgentMode;
  children: React.ReactNode;
  /** When true, tooltip shows "ModeName: Description". When false, only description. */
  showTitle?: boolean;
}) {
  const { t } = useI18n();
  const label = t.inputBox[getModeLabelKey(mode)];
  const description = t.inputBox[getModeDescriptionKey(mode)];
  const content = showTitle ? `${label}: ${description}` : description;

  return <Tooltip content={content}>{children}</Tooltip>;
}
