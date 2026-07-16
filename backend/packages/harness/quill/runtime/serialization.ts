/**
 * Canonical serialization for LangChain / LangGraph objects.
 *
 * Provides a single source of truth for converting LangChain message objects,
 * model objects, and LangGraph state dicts into plain JSON-serialisable
 * structures.
 *
 * Consumers: `quill.runtime.runs.worker` (SSE publishing) and
 * `app.gateway.routers.threads` (REST responses).
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function callMethod(obj: object, name: string): { ok: boolean; value?: unknown } {
  const fn = (obj as Record<string, unknown>)[name];
  if (typeof fn === "function") {
    try {
      return { ok: true, value: (fn as (...args: unknown[]) => unknown).call(obj) };
    } catch {
      return { ok: false };
    }
  }
  return { ok: false };
}

/** Recursively serialize a LangChain object to a JSON-serialisable value. */
export function serializeLcObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return null;
  }
  if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => serializeLcObject(item));
  }
  if (isPlainObject(obj)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeLcObject(value);
    }
    return result;
  }
  if (typeof obj === "object") {
    // Model-like objects (LangChain messages, pydantic-equivalents). Try the
    // JS serialization hooks in the same spirit as Python's model_dump()/dict().
    for (const method of ["model_dump", "dict", "toDict", "toJSON"]) {
      const attempt = callMethod(obj, method);
      if (attempt.ok) {
        return attempt.value;
      }
    }
    // Interrupt-like objects (no serialization hook) — mirror the Python
    // special-case that surfaces {value, id}.
    if ((obj as { constructor?: { name?: string } }).constructor?.name === "Interrupt") {
      return serializeLcObject({
        value: (obj as { value?: unknown }).value,
        id: (obj as { id?: unknown }).id ?? null,
      });
    }
  }
  // Last resort
  try {
    return String(obj);
  } catch {
    return Object.prototype.toString.call(obj);
  }
}

/**
 * Serialize channel values, stripping internal LangGraph keys.
 *
 * Only `__pregel_*` keys are removed — `__interrupt__` is deliberately
 * preserved so the LangGraph SDK can detect interrupt events from values
 * chunks (see issue #3595).
 */
export function serializeChannelValues(channelValues: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(channelValues)) {
    if (key.startsWith("__pregel_")) {
      continue;
    }
    result[key] = serializeLcObject(value);
  }
  return result;
}

/**
 * Remove `data:`-scheme `image_url` blocks from *hide_from_ui* messages.
 *
 * The history and run-wait endpoints return checkpoint-persisted messages to
 * the frontend. `ViewImageMiddleware` stores full base64 image payloads in
 * `hide_from_ui` human messages — these are internal model context and must not
 * be sent over the wire (huge response bodies, no UI value).
 *
 * Only content blocks of type `image_url` whose URL starts with `data:` are
 * stripped. Text blocks, `https://` image URLs, and non-hidden messages are
 * left untouched so that message ordering and count are preserved.
 */
export function stripDataUrlImageBlocks(messages: unknown[]): unknown[] {
  const result: unknown[] = [];
  for (const msg of messages) {
    if (!isPlainObject(msg)) {
      result.push(msg);
      continue;
    }

    // Only touch messages explicitly flagged as hidden from the UI.
    const additionalKwargs = msg["additional_kwargs"];
    if (!(isPlainObject(additionalKwargs) && additionalKwargs["hide_from_ui"] === true)) {
      result.push(msg);
      continue;
    }

    const content = msg["content"];
    if (!Array.isArray(content)) {
      result.push(msg);
      continue;
    }

    // Filter out image_url blocks with data: scheme.
    const filtered = content.filter((block) => {
      if (!isPlainObject(block) || block["type"] !== "image_url") {
        return true;
      }
      const imageUrl = block["image_url"];
      if (!isPlainObject(imageUrl)) {
        return true;
      }
      return !String(imageUrl["url"] ?? "").startsWith("data:");
    });
    result.push({ ...msg, content: filtered });
  }
  return result;
}

/**
 * Serialize channel values and strip base64 image data from messages.
 *
 * Convenience wrapper combining {@link serializeChannelValues} with
 * {@link stripDataUrlImageBlocks}. Use this in all REST endpoints that return
 * channel values to the frontend so that `data:`-scheme base64 image payloads
 * are never sent over the wire.
 */
export function serializeChannelValuesForApi(channelValues: Record<string, unknown>): Record<string, unknown> {
  const result = serializeChannelValues(channelValues);
  if (Array.isArray(result["messages"])) {
    result["messages"] = stripDataUrlImageBlocks(result["messages"] as unknown[]);
  }
  return result;
}

/** Serialize a messages-mode tuple `(chunk, metadata)`. */
export function serializeMessagesTuple(obj: unknown): unknown {
  if (Array.isArray(obj) && obj.length === 2) {
    const [chunk, metadata] = obj;
    return [serializeLcObject(chunk), isPlainObject(metadata) ? metadata : {}];
  }
  return serializeLcObject(obj);
}

/**
 * Serialize LangChain objects with mode-specific handling.
 *
 * * `messages` — obj is `(message_chunk, metadata_dict)`
 * * `values` — obj is the full state dict; `__pregel_*` keys stripped and
 *   base64 `data:` image blocks dropped from hide_from_ui messages
 * * everything else — recursive model_dump() / dict() fallback
 */
export function serialize(obj: unknown, { mode = "" }: { mode?: string } = {}): unknown {
  if (mode === "messages") {
    return serializeMessagesTuple(obj);
  }
  if (mode === "values") {
    // `values` snapshots stream the full state to the frontend, so they must
    // drop base64 image payloads the same way the REST endpoints do.
    return isPlainObject(obj) ? serializeChannelValuesForApi(obj) : serializeLcObject(obj);
  }
  return serializeLcObject(obj);
}
