/**
 * Skills API request/response contracts.
 */

export type SkillCategory = "public" | "custom";

export interface SkillResponse {
  /** Name of the skill */
  name: string;
  /** Description of what the skill does */
  description: string;
  /** License information */
  license?: string | null;
  /** Category of the skill (public or custom) */
  category: SkillCategory;
  /** Whether this skill is enabled */
  enabled?: boolean;
}

export interface SkillsListResponse {
  skills: SkillResponse[];
}

export interface SkillUpdateRequest {
  /** Whether to enable or disable the skill */
  enabled: boolean;
}

export interface SkillInstallRequest {
  /** The thread ID where the .skill file is located */
  thread_id: string;
  /** Virtual path to the .skill file */
  path: string;
}

export interface SkillInstallResponse {
  /** Whether the installation was successful */
  success: boolean;
  /** Name of the installed skill */
  skill_name: string;
  /** Installation result message */
  message: string;
}

export interface CustomSkillContentResponse extends SkillResponse {
  /** Raw SKILL.md content */
  content: string;
}

export interface CustomSkillUpdateRequest {
  /** Replacement SKILL.md content */
  content: string;
}

export interface CustomSkillHistoryResponse {
  history: Array<Record<string, unknown>>;
}

export interface SkillRollbackRequest {
  /** History entry index to restore from */
  history_index?: number;
}
