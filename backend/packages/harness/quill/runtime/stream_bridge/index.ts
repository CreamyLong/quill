/**
 * Stream bridge — decouples agent workers from SSE endpoints.
 *
 * A `StreamBridge` sits between the background task that runs an agent
 * (producer) and the HTTP endpoint that pushes Server-Sent Events to the client
 * (consumer). This package provides an abstract protocol ({@link StreamBridge})
 * plus a default in-memory implementation.
 */

export { makeStreamBridge } from "./async_provider.js";
export { END_SENTINEL, HEARTBEAT_SENTINEL, StreamBridge, StreamEvent } from "./base.js";
export { MemoryStreamBridge } from "./memory.js";
