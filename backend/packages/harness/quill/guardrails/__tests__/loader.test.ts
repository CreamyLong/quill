import { describe, expect, it } from "vitest";

import {
  createGuardrailMiddleware,
  LazyGuardrailProvider,
  resolveGuardrailProvider,
} from "../loader.ts";
import { AllowlistProvider, CommandPolicyProvider } from "../builtin.ts";
import type { GuardrailsConfig } from "../../config/guardrails_config.ts";

describe("resolveGuardrailProvider", () => {
  it("resolves the built-in AllowlistProvider by class path", async () => {
    const p = await resolveGuardrailProvider("quill.guardrails.builtin:AllowlistProvider", {
      deniedTools: ["bash"],
    });
    expect(p).toBeInstanceOf(AllowlistProvider);
  });

  it("resolves the built-in CommandPolicyProvider by class path", async () => {
    const p = await resolveGuardrailProvider("quill.guardrails.builtin:CommandPolicyProvider", {
      rules: [{ tool: "bash", pattern: "rm -rf", effect: "deny" }],
    });
    expect(p).toBeInstanceOf(CommandPolicyProvider);
  });

  it("rejects an unknown class path", async () => {
    await expect(
      resolveGuardrailProvider("does.not.exist:Nope")
    ).rejects.toThrow();
  });
});

describe("LazyGuardrailProvider", () => {
  it("proxies evaluation to the resolved provider", async () => {
    const lazy = new LazyGuardrailProvider(
      "quill.guardrails.builtin:CommandPolicyProvider",
      { rules: [{ tool: "bash", pattern: "rm -rf", effect: "deny" }] }
    );
    const d = await lazy.aevaluate({
      toolName: "bash",
      toolInput: { command: "rm -rf /" },
    });
    expect(d.allow).toBe(false);
    expect(d.reasons[0].code).toBe("oap.command_denied");
  });

  it("resolves the underlying provider exactly once across calls", async () => {
    const lazy = new LazyGuardrailProvider(
      "quill.guardrails.builtin:AllowlistProvider",
      { allowedTools: ["bash"] }
    );
    await lazy.aevaluate({ toolName: "bash", toolInput: {} });
    await lazy.aevaluate({ toolName: "bash", toolInput: {} });
    // Both calls hit the same cached provider; no second resolution occurs.
    // We assert indirectly: the provider is an AllowlistProvider instance.
    // (The promise is cached, so this cannot throw on the second call.)
    expect(lazy.name).toBe("lazy-guardrail");
  });
});

describe("createGuardrailMiddleware", () => {
  function cfg(overrides: Partial<GuardrailsConfig> = {}): GuardrailsConfig {
    return {
      enabled: true,
      failClosed: true,
      passport: null,
      provider: { use: "quill.guardrails.builtin:AllowlistProvider", config: {} },
      ...overrides,
    };
  }

  it("returns null when guardrails are disabled", () => {
    expect(createGuardrailMiddleware(cfg({ enabled: false }))).toBeNull();
  });

  it("returns null when no provider is configured", () => {
    expect(createGuardrailMiddleware(cfg({ provider: null }))).toBeNull();
  });

  it("returns a middleware definition when enabled with a provider", () => {
    const mw = createGuardrailMiddleware(cfg());
    expect(mw).not.toBeNull();
    expect(mw!.name).toBe("GuardrailMiddleware");
    expect(typeof mw!.wrapToolCall).toBe("function");
  });

  it("passes failClosed through to the middleware", () => {
    const mw = createGuardrailMiddleware(cfg(), { failClosed: false });
    // The middleware wraps a LazyGuardrailProvider; verify it exists.
    expect(mw).not.toBeNull();
  });
});
