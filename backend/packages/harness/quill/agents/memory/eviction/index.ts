/**
 * Memory Eviction Policies — public API.
 *
 * Port of DeerFlow 2.0's DeerMem eviction module. Prevents unbounded memory
 * growth by evicting low-value facts when capacity is exceeded.
 */

export * from "./types.js";
export {
  confidenceBasedEviction,
  hybridV1Eviction,
  selectFactsForCapacity,
  wouldEvict,
  getEvictionStats,
} from "./policies.js";
