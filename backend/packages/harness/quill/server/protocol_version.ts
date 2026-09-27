/**
 * Protocol Versioning & Capability Negotiation.
 *
 * Ports the transport-level patterns of ZCode's Protocol V4
 * (`zcode-protocol-v4`, `V4Gateway`, `HelloMessage`/`ClientHello`) onto
 * Quill's HTTP gateway, so any client (web, desktop, TUI, SDK) can
 * negotiate once and degrade gracefully across versions:
 *
 * - **Versioned handshake** — `GET /api/protocol/hello` returns the
 *   server's protocol version, server time, and capability list; clients
 *   may announce their own version + capabilities (mirrors `HelloMessage` /
 *   `ClientHello`).
 * - **Wire-version negotiation** — requests may carry
 *   `X-Quill-Protocol-Version`. A *newer* version than the server supports
 *   is rejected with 400 + the supported range (fail fast, no silent
 *   mismatch); an *older* version is served with a deprecation header
 *   (backward compatibility).
 * - **Compat-field tolerance** — `stripUnknownFields` implements ZCode's
 *   "optional compat fields" pattern: newer clients may send fields older
 *   servers don't know; instead of rejecting, the server strips them and
 *   reports what it ignored.
 * - **Method-not-found graceful degradation** — `isMethodNotFoundError`
 *   identifies the JSON-RPC-style `-32601` (and HTTP 404) so callers can
 *   fall back to an older method instead of throwing.
 * - **Payload schema versioning** — versioned payloads (shares, exports)
 *   carry `schema_version`; `checkPayloadSchemaVersion` rejects versions
 *   newer than the reader understands (upstream: "clients throw if the
 *   version is higher than they understand").
 *
 * @module server/protocol_version
 */

// ---------------------------------------------------------------------------
// Version + capabilities
// ---------------------------------------------------------------------------

/** Current gateway protocol version. */
export const PROTOCOL_VERSION = 1;

/** Versions the server can still serve (oldest supported wire version). */
export const MIN_SUPPORTED_PROTOCOL_VERSION = 1;

/** Header carrying the client-requested protocol version. */
export const PROTOCOL_VERSION_HEADER = "x-quill-protocol-version";

/** Response header advertising the server's protocol version. */
export const SERVER_VERSION_HEADER = "x-quill-protocol-version";

/** Response header set when serving an older (deprecated) wire version. */
export const DEPRECATION_HEADER = "deprecation";

/** Capabilities the gateway advertises in the handshake. */
export const SERVER_CAPABILITIES: readonly string[] = [
  "threads",
  "runs",
  "streaming",
  "skills",
  "scheduled-tasks",
  "off-peak-tasks",
  "command-inbox",
  "git-checkpoints",
  "shares",
  "migrations",
  "dynamic-workflows",
  "memory",
  "telemetry",
  "models",
];

// ---------------------------------------------------------------------------
// Negotiation
// ---------------------------------------------------------------------------

export type NegotiationStatus = "ok" | "deprecated" | "unsupported";

export interface NegotiationResult {
  status: NegotiationStatus;
  /** Version the server will serve with. */
  version: number;
  /** All versions the server supports, ascending. */
  supportedVersions: number[];
  /** Present when status === "unsupported". */
  error?: string;
}

/**
 * Negotiate the wire version for one request. Absent header → current
 * version. Newer than supported → `unsupported` (caller must 400). Older
 * than current but ≥ min → `deprecated` (served, with a warning header).
 */
export function negotiateProtocolVersion(requestedRaw: string | undefined): NegotiationResult {
  const supportedVersions: number[] = [];
  for (let v = MIN_SUPPORTED_PROTOCOL_VERSION; v <= PROTOCOL_VERSION; v += 1) {
    supportedVersions.push(v);
  }

  if (requestedRaw === undefined || requestedRaw.trim() === "") {
    return { status: "ok", version: PROTOCOL_VERSION, supportedVersions };
  }
  const requested = Number.parseInt(requestedRaw.trim(), 10);
  if (!Number.isFinite(requested) || requested <= 0) {
    return {
      status: "unsupported",
      version: PROTOCOL_VERSION,
      supportedVersions,
      error: `invalid ${PROTOCOL_VERSION_HEADER}: "${requestedRaw}"`,
    };
  }
  if (requested > PROTOCOL_VERSION) {
    return {
      status: "unsupported",
      version: PROTOCOL_VERSION,
      supportedVersions,
      error: `client requests protocol ${requested} but this server supports up to ${PROTOCOL_VERSION}`,
    };
  }
  if (requested < MIN_SUPPORTED_PROTOCOL_VERSION) {
    return {
      status: "unsupported",
      version: PROTOCOL_VERSION,
      supportedVersions,
      error: `client requests protocol ${requested} but this server supports ${MIN_SUPPORTED_PROTOCOL_VERSION}..${PROTOCOL_VERSION}`,
    };
  }
  return {
    status: requested === PROTOCOL_VERSION ? "ok" : "deprecated",
    version: requested,
    supportedVersions,
  };
}

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

export interface HelloResponse {
  protocolVersion: number;
  minSupportedProtocolVersion: number;
  serverTime: string;
  capabilities: readonly string[];
  /** Echo of the client's announced capabilities (empty when absent). */
  clientCapabilities: string[];
}

/**
 * Build the handshake response. Clients pass their announced capabilities;
 * the server echoes them so the client can confirm what was received
 * (mirrors `ClientHello` handling).
 */
export function buildHelloResponse(clientCapabilities?: unknown): HelloResponse {
  const announced = Array.isArray(clientCapabilities)
    ? clientCapabilities.filter((c): c is string => typeof c === "string")
    : [];
  return {
    protocolVersion: PROTOCOL_VERSION,
    minSupportedProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION,
    serverTime: new Date().toISOString(),
    capabilities: SERVER_CAPABILITIES,
    clientCapabilities: announced,
  };
}

// ---------------------------------------------------------------------------
// Compat-field tolerance (ZCode "optional compat fields + retry")
// ---------------------------------------------------------------------------

export interface StrippedPayload<T> {
  /** The payload restricted to known fields. */
  accepted: T;
  /** Fields the server ignored because it doesn't know them. */
  ignored: string[];
}

/**
 * Strip unknown fields from a request payload instead of rejecting the
 * request: newer clients may send newer optional fields; older servers
 * ignore them and carry on (upstream retries with fields omitted — here the
 * server does the omission server-side).
 */
export function stripUnknownFields<T extends Record<string, unknown>>(
  payload: T,
  knownKeys: readonly string[],
): StrippedPayload<T> {
  const known = new Set(knownKeys);
  const accepted: Record<string, unknown> = {};
  const ignored: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (known.has(key)) {
      accepted[key] = value;
    } else {
      ignored.push(key);
    }
  }
  return { accepted: accepted as T, ignored };
}

// ---------------------------------------------------------------------------
// Method-not-found graceful degradation
// ---------------------------------------------------------------------------

/** JSON-RPC method-not-found code used across ZCode protocol surfaces. */
export const METHOD_NOT_FOUND_CODE = -32601;

/**
 * Whether an error means "the server doesn't have this method/field" — the
 * caller should fall back to an older method instead of throwing (upstream:
 * `-32601` on `workspaceUpdateModelIoPreferences` is ignored;
 * `pluginsReferenceCatalogWithCategory` falls back to
 * `pluginsReferenceCatalog`).
 */
export function isMethodNotFoundError(err: unknown): boolean {
  if (err !== null && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (code === METHOD_NOT_FOUND_CODE || code === 404 || code === -32020) {
      return true;
    }
    const status = (err as { status?: unknown }).status;
    if (status === 404) {
      return true;
    }
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && /not found|unknown (method|field|route)/i.test(message)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Payload schema versioning
// ---------------------------------------------------------------------------

export class UnsupportedSchemaVersionError extends Error {
  constructor(
    readonly payloadVersion: number,
    readonly readerVersion: number,
  ) {
    super(
      `payload schema_version ${payloadVersion} is newer than this reader understands (${readerVersion})`,
    );
    this.name = "UnsupportedSchemaVersionError";
  }
}

/**
 * Guard for versioned payloads (shares, exports): readers reject payloads
 * whose `schema_version` is higher than they understand. Missing
 * `schema_version` is treated as version 1 (legacy tolerance).
 */
export function checkPayloadSchemaVersion(
  payload: { schema_version?: unknown },
  readerVersion: number,
): number {
  const version =
    typeof payload.schema_version === "number" && Number.isFinite(payload.schema_version)
      ? payload.schema_version
      : 1;
  if (version > readerVersion) {
    throw new UnsupportedSchemaVersionError(version, readerVersion);
  }
  return version;
}
