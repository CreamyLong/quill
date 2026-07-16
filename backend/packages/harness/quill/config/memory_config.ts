/**
 * Configuration for global memory mechanism.
 */

export type TokenCountingStrategy = "tiktoken" | "char";

export interface MemoryConfig {
  /** Whether to enable memory mechanism */
  enabled: boolean;
  /** Path to store memory data */
  storagePath: string;
  /** The class path for memory storage provider */
  storageClass: string;
  /** Seconds to wait before processing queued updates (debounce) */
  debounceSeconds: number;
  /** Model name to use for memory updates (null = use default model) */
  modelName: string | null;
  /** Maximum number of facts to store */
  maxFacts: number;
  /** Minimum confidence threshold for storing facts */
  factConfidenceThreshold: number;
  /** Whether to inject memory into system prompt */
  injectionEnabled: boolean;
  /** Maximum tokens to use for memory injection */
  maxInjectionTokens: number;
  /** Token counting strategy for memory-injection budgeting */
  tokenCounting: TokenCountingStrategy;
  /** Fact categories always injected into the prompt */
  guaranteedCategories: string[];
  /** Token ceiling for guaranteed-category facts */
  guaranteedTokenBudget: number;
}

let _memoryConfig: MemoryConfig = {
  enabled: true,
  storagePath: "",
  storageClass: "quill.agents.memory.storage.FileMemoryStorage",
  debounceSeconds: 30,
  modelName: null,
  maxFacts: 100,
  factConfidenceThreshold: 0.7,
  injectionEnabled: true,
  maxInjectionTokens: 2000,
  tokenCounting: "tiktoken",
  guaranteedCategories: ["correction"],
  guaranteedTokenBudget: 500,
};

/** Get the current memory configuration. */
export function getMemoryConfig(): MemoryConfig {
  return _memoryConfig;
}

/** Set the memory configuration. */
export function setMemoryConfig(config: MemoryConfig): void {
  _memoryConfig = config;
}

/** Load memory configuration from a partial dictionary. */
export function loadMemoryConfigFromDict(configDict: Partial<MemoryConfig>): void {
  _memoryConfig = {
    ..._memoryConfig,
    ...configDict,
    guaranteedCategories: configDict.guaranteedCategories ?? _memoryConfig.guaranteedCategories,
  };
}
