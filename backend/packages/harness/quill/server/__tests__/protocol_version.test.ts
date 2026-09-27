/**
 * Tests for protocol versioning & capability negotiation (ZCode Protocol V4
 * patterns). Covers negotiation outcomes, the handshake, compat-field
 * stripping, method-not-found detection, and payload schema version guards.
 */

import { describe, expect, it } from "vitest";

import {
  METHOD_NOT_FOUND_CODE,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  SERVER_CAPABILITIES,
  UnsupportedSchemaVersionError,
  buildHelloResponse,
  checkPayloadSchemaVersion,
  isMethodNotFoundError,
  negotiateProtocolVersion,
  stripUnknownFields,
} from "../protocol_version.js";

describe("negotiateProtocolVersion", () => {
  it("serves the current version when no header is present", () => {
    const result = negotiateProtocolVersion(undefined);
    expect(result.status).toBe("ok");
    expect(result.version).toBe(PROTOCOL_VERSION);
  });

  it("accepts an exact match", () => {
    expect(negotiateProtocolVersion(String(PROTOCOL_VERSION)).status).toBe("ok");
  });

  it("rejects versions newer than the server with the supported range", () => {
    const result = negotiateProtocolVersion(String(PROTOCOL_VERSION + 1));
    expect(result.status).toBe("unsupported");
    expect(result.error).toContain(`up to ${PROTOCOL_VERSION}`);
    expect(result.supportedVersions).toHaveLength(PROTOCOL_VERSION - MIN_SUPPORTED_PROTOCOL_VERSION + 1);
    expect(result.supportedVersions[0]).toBe(MIN_SUPPORTED_PROTOCOL_VERSION);
    expect(result.supportedVersions[result.supportedVersions.length - 1]).toBe(PROTOCOL_VERSION);
  });

  it("rejects garbage and non-numeric headers", () => {
    expect(negotiateProtocolVersion("abc").status).toBe("unsupported");
    expect(negotiateProtocolVersion("-1").status).toBe("unsupported");
    expect(negotiateProtocolVersion("0").status).toBe("unsupported");
  });
});

describe("buildHelloResponse", () => {
  it("returns the server version, time, and capabilities", () => {
    const hello = buildHelloResponse();
    expect(hello.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(hello.capabilities).toEqual(SERVER_CAPABILITIES);
    expect(hello.clientCapabilities).toEqual([]);
    expect(() => new Date(hello.serverTime).toISOString()).not.toThrow();
  });

  it("echoes string client capabilities and drops non-strings", () => {
    const hello = buildHelloResponse(["desktop", 42, null, "tui"]);
    expect(hello.clientCapabilities).toEqual(["desktop", "tui"]);
  });
});

describe("stripUnknownFields", () => {
  it("keeps known fields and reports ignored ones", () => {
    const { accepted, ignored } = stripUnknownFields(
      { name: "task", prompt: "go", thoughtLevel: "deep", offPeakToolEnabled: true },
      ["name", "prompt"],
    );
    expect(accepted).toEqual({ name: "task", prompt: "go" });
    expect(ignored).toEqual(["thoughtLevel", "offPeakToolEnabled"]);
  });

  it("passes through payloads with only known fields", () => {
    const { accepted, ignored } = stripUnknownFields({ a: 1 }, ["a"]);
    expect(accepted).toEqual({ a: 1 });
    expect(ignored).toEqual([]);
  });
});

describe("isMethodNotFoundError", () => {
  it("recognizes JSON-RPC -32601, HTTP 404, and -32020", () => {
    expect(isMethodNotFoundError({ code: METHOD_NOT_FOUND_CODE })).toBe(true);
    expect(isMethodNotFoundError({ code: 404 })).toBe(true);
    expect(isMethodNotFoundError({ code: -32020 })).toBe(true);
    expect(isMethodNotFoundError({ status: 404 })).toBe(true);
    expect(isMethodNotFoundError(new Error("Method not found"))).toBe(true);
    expect(isMethodNotFoundError(new Error("unknown field: x"))).toBe(true);
  });

  it("does not match other errors", () => {
    expect(isMethodNotFoundError({ code: -32603 })).toBe(false);
    expect(isMethodNotFoundError(new Error("network down"))).toBe(false);
    expect(isMethodNotFoundError(null)).toBe(false);
  });
});

describe("checkPayloadSchemaVersion", () => {
  it("accepts versions the reader understands and treats missing as 1", () => {
    expect(checkPayloadSchemaVersion({ schema_version: 1 }, 2)).toBe(1);
    expect(checkPayloadSchemaVersion({ schema_version: 2 }, 2)).toBe(2);
    expect(checkPayloadSchemaVersion({}, 1)).toBe(1);
  });

  it("rejects payload versions newer than the reader", () => {
    expect(() => checkPayloadSchemaVersion({ schema_version: 3 }, 2)).toThrow(
      UnsupportedSchemaVersionError,
    );
  });
});
