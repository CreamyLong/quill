/**
 * Model Trajectory — recording and replay of model decision paths.
 *
 * Inspired by ZCode's model trajectory recording and DeepSeek Harness's
 * session log as deterministic replay source.
 */

export {
  type TrajectoryNodeType,
  type TrajectoryNode,
  type TrajectoryEdge,
  type TrajectoryGraph,
  type ReplayOptions,
  type ReplayResult,
  type TrajectoryConfig,
  DEFAULT_TRAJECTORY_CONFIG,
} from "./types.js";

export {
  type TrajectoryRawEvent,
  TrajectoryRecorder,
  getTrajectoryRecorder,
  resetTrajectoryRecorder,
} from "./recorder.js";
