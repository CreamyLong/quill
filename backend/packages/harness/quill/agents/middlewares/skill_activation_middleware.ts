/**
 * Middleware for explicit slash skill activation.
 *
 * Faithful port of Python `SkillActivationMiddleware`. When the user explicitly
 * types `/skill-name`, the full SKILL.md content is injected (as a hidden
 * HumanMessage placed right before the target user message) so the model follows
 * that skill for the turn.
 *
 * Dependency notes (report):
 * - `quill.skills.slash` (parse/resolve) and `quill.skills.storage`
 *   (`SkillStorage`, `get_or_new_skill_storage`) are NOT ported to TS. They are
 *   injected via options (`parseSlashSkillReference`, `resolveSlashSkill`,
 *   `storage`). When any is absent the middleware is a passthrough.
 * - `SKILL_MD_FILE` (skills/types.ts) and `getOriginalUserContentText`
 *   (utils/messages.ts) are reused from their existing TS ports.
 * - The run-journal audit (`request.runtime.context["__run_journal"]`) has no TS
 *   analogue and is a no-op.
 */

import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import type { MiddlewareDefinition, ModelRequest } from "../factory.js";
import { SKILL_MD_FILE } from "../../skills/types.js";
import { getOriginalUserContentText } from "../../utils/messages.js";

const SLASH_SKILL_ACTIVATION_KEY = "slash_skill_activation";
const SLASH_SKILL_ACTIVATION_TARGET_ID_KEY = "slash_skill_activation_target_id";
const SUMMARY_MESSAGE_NAME = "summary";

/** Minimal skill shape needed by this middleware (subset of skills/types Skill). */
export interface SkillLike {
  name: string;
  enabled: boolean;
  category: string;
  skillFile: string;
}

export interface SlashSkillReference {
  name: string;
}

export interface ResolvedSlashSkill {
  skill: SkillLike;
  containerFilePath: string;
  remainingText: string;
}

export interface SkillStorageLike {
  loadSkills(opts: { enabledOnly: boolean }): SkillLike[];
  getContainerRoot(): string;
  getSkillsRootPath(): string;
}

export interface SkillActivationOptions {
  /** Set of skills available to this agent, or null for no restriction. */
  availableSkills?: Set<string> | null;
  /** Skill storage backend (injected; not ported to TS). */
  storage?: SkillStorageLike;
  /** Parse a leading `/skill-name` reference from user text. */
  parseSlashSkillReference?: (text: string) => SlashSkillReference | null;
  /** Resolve a slash skill against the loaded skill list. */
  resolveSlashSkill?: (
    text: string,
    skills: SkillLike[],
    opts: { availableSkills: Set<string> | null; containerBasePath: string }
  ) => ResolvedSlashSkill | null;
}

interface Activation {
  skillName: string;
  category: string;
  containerFilePath: string;
  skillContent: string;
  contentHash: string;
  remainingText: string;
}

interface ActivationResolution {
  activation?: Activation | null;
  failureMessage?: string | null;
}

/** Escape `& < >` (and, when quote=true, `" '`) as HTML entities. */
function htmlEscape(text: string, quote = true): string {
  let result = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (quote) {
    result = result.replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  }
  return result;
}

/** Return whether a message is hidden slash-skill activation context. */
export function isSlashSkillActivationReminder(message: BaseMessage): boolean {
  return (
    message instanceof HumanMessage &&
    Boolean((message.additional_kwargs ?? {})[SLASH_SKILL_ACTIVATION_KEY])
  );
}

function isUserActivationTarget(message: BaseMessage): boolean {
  if (!(message instanceof HumanMessage)) {
    return false;
  }
  if (message.name === SUMMARY_MESSAGE_NAME) {
    return false;
  }
  if ((message.additional_kwargs ?? {})["hide_from_ui"]) {
    return false;
  }
  return true;
}

/** Read SKILL.md content, verifying it stays within the configured skills root. */
function readSkillContent(skillFile: string, skillsRoot: string): string {
  if (path.basename(skillFile) !== SKILL_MD_FILE) {
    throw new Error(`Expected ${SKILL_MD_FILE}, got ${path.basename(skillFile)}`);
  }
  const resolvedRoot = path.resolve(skillsRoot);
  const resolvedFile = path.resolve(skillFile);
  if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(resolvedRoot + path.sep)) {
    throw new Error("Resolved skill file must stay within the configured skills root.");
  }
  if (!fs.existsSync(resolvedFile) || !fs.statSync(resolvedFile).isFile()) {
    throw new Error(`Not a file: ${resolvedFile}`);
  }
  return fs.readFileSync(resolvedFile, "utf-8");
}

/** Inject full SKILL.md content when the user explicitly types /skill-name. */
export function skillActivationMiddleware(
  options: SkillActivationOptions = {}
): MiddlewareDefinition {
  const availableSkills =
    options.availableSkills !== undefined && options.availableSkills !== null
      ? new Set(options.availableSkills)
      : null;
  const { storage, parseSlashSkillReference, resolveSlashSkill } = options;

  function resolveActivation(text: string): ActivationResolution | null {
    if (!storage || !parseSlashSkillReference || !resolveSlashSkill) {
      return null;
    }
    const reference = parseSlashSkillReference(text);
    if (reference === null) {
      return null;
    }

    const skills = storage.loadSkills({ enabledOnly: false });
    const skill = skills.find((candidate) => candidate.name === reference.name);
    if (skill === undefined) {
      return { failureMessage: `Skill \`/${reference.name}\` is not installed.` };
    }
    if (!skill.enabled) {
      return {
        failureMessage: `Skill \`/${reference.name}\` is installed but disabled. Enable it before using slash activation.`,
      };
    }
    if (availableSkills !== null && !availableSkills.has(reference.name)) {
      return { failureMessage: `Skill \`/${reference.name}\` is not available for this agent.` };
    }

    const resolved = resolveSlashSkill(text, skills, {
      availableSkills,
      containerBasePath: storage.getContainerRoot(),
    });
    if (resolved === null) {
      return { failureMessage: `Skill \`/${reference.name}\` could not be resolved.` };
    }

    let skillContent: string;
    try {
      skillContent = readSkillContent(resolved.skill.skillFile, storage.getSkillsRootPath());
    } catch {
      console.warn(`Failed to read slash-activated skill ${resolved.skill.name}`);
      return {
        failureMessage: `Skill \`/${reference.name}\` could not be loaded safely. Please check the skill installation.`,
      };
    }

    const contentHash = createHash("sha256").update(skillContent, "utf-8").digest("hex");
    return {
      activation: {
        skillName: resolved.skill.name,
        category: String(resolved.skill.category),
        containerFilePath: resolved.containerFilePath,
        skillContent,
        contentHash,
        remainingText: resolved.remainingText,
      },
    };
  }

  function buildActivationReminder(activation: Activation): string {
    const userRequest =
      activation.remainingText ||
      "No additional task text was provided after the slash skill command. Ask the user what they want to do with this skill if the next step is unclear.";
    const escapedUserRequest = htmlEscape(userRequest, false);
    const escapedSkillContent = htmlEscape(activation.skillContent, false);
    const escapedSkillName = htmlEscape(activation.skillName, true);
    const escapedCategory = htmlEscape(activation.category, true);
    const escapedPath = htmlEscape(activation.containerFilePath, true);
    const escapedContentHash = htmlEscape(activation.contentHash, true);
    return `<slash_skill_activation>
The user explicitly activated the \`${activation.skillName}\` skill for this turn.
Treat the task text as:
<user_request>
${escapedUserRequest}
</user_request>

Follow this skill before choosing a general workflow. Load supporting resources from the same skill directory only when needed.

<skill name="${escapedSkillName}" category="${escapedCategory}" path="${escapedPath}" sha256="${escapedContentHash}">
<skill_content encoding="xml-escaped">
${escapedSkillContent}
</skill_content>
</skill>
</slash_skill_activation>`;
  }

  function hasExistingActivationForTarget(
    messages: BaseMessage[],
    targetIndex: number,
    target: HumanMessage
  ): boolean {
    if (targetIndex <= 0) {
      return false;
    }

    if (target.id) {
      for (const previous of messages.slice(0, targetIndex)) {
        if (!isSlashSkillActivationReminder(previous)) {
          continue;
        }
        const targetId = (previous.additional_kwargs ?? {})[SLASH_SKILL_ACTIVATION_TARGET_ID_KEY];
        if (targetId === target.id || previous.id === `${target.id}__slash_activation`) {
          return true;
        }
      }
    }

    const previous = messages[targetIndex - 1];
    return isSlashSkillActivationReminder(previous);
  }

  function findActivationTarget(
    messages: BaseMessage[]
  ): [number, HumanMessage, ActivationResolution] | null {
    if (messages.length === 0) {
      return null;
    }

    let targetIndex = -1;
    for (let idx = messages.length - 1; idx >= 0; idx--) {
      if (isUserActivationTarget(messages[idx])) {
        targetIndex = idx;
        break;
      }
    }
    if (targetIndex < 0) {
      return null;
    }

    const target = messages[targetIndex] as HumanMessage;
    if (hasExistingActivationForTarget(messages, targetIndex, target)) {
      return null;
    }

    const content = getOriginalUserContentText(target.content, target.additional_kwargs);
    const resolution = resolveActivation(content);
    if (resolution === null) {
      return null;
    }
    return [targetIndex, target, resolution];
  }

  function makeActivationMessage(target: HumanMessage, activationContent: string): HumanMessage {
    const stableId = target.id || randomUUID();
    const additionalKwargs: Record<string, unknown> = {
      hide_from_ui: true,
      [SLASH_SKILL_ACTIVATION_KEY]: true,
    };
    if (target.id) {
      additionalKwargs[SLASH_SKILL_ACTIVATION_TARGET_ID_KEY] = target.id;
    }
    return new HumanMessage({
      content: activationContent,
      id: `${stableId}__slash_activation`,
      additional_kwargs: additionalKwargs,
    });
  }

  function prepareModelRequest(request: ModelRequest): ModelRequest | AIMessage | null {
    const targetAndResolution = findActivationTarget([...request.messages]);
    if (targetAndResolution === null) {
      return null;
    }

    const [targetIndex, target, resolution] = targetAndResolution;
    if (resolution.failureMessage) {
      return new AIMessage(resolution.failureMessage);
    }

    const activation = resolution.activation;
    if (activation === null || activation === undefined) {
      return null;
    }

    console.info(
      `SkillActivationMiddleware: activating slash skill ${activation.skillName} ` +
        `category=${activation.category} path=${activation.containerFilePath} hash=${activation.contentHash}`
    );
    const activationMsg = makeActivationMessage(target, buildActivationReminder(activation));
    const messages = [...request.messages];
    messages.splice(targetIndex, 0, activationMsg);
    return { messages };
  }

  return {
    name: "SkillActivationMiddleware",
    wrapModelCall: async (request, handler) => {
      const prepared = prepareModelRequest(request);
      if (prepared === null) {
        return handler(request);
      }
      if (prepared instanceof AIMessage) {
        return prepared;
      }
      return handler(prepared);
    },
  };
}
