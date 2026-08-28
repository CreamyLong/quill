import { describe, expect, it } from "vitest";

import { CommandPolicyProvider } from "../builtin.ts";

function req(toolName: string, toolInput: Record<string, unknown>) {
  return { toolName, toolInput };
}

describe("CommandPolicyProvider", () => {
  it("allows by default when no rules are configured", async () => {
    const p = new CommandPolicyProvider();
    const d = await p.aevaluate(req("bash", { command: "rm -rf /" }));
    expect(d.allow).toBe(true);
    expect(d.reasons[0].code).toBe("oap.allowed");
  });

  it("denies when a deny rule matches the command", async () => {
    const p = new CommandPolicyProvider({
      rules: [{ tool: "bash", pattern: "^rm\\s+-rf\\s+/$", effect: "deny", description: "no root wipe" }],
    });
    const d = await p.aevaluate(req("bash", { command: "rm -rf /" }));
    expect(d.allow).toBe(false);
    expect(d.reasons[0].code).toBe("oap.command_denied");
    expect(d.reasons[0].message).toBe("no root wipe");
    expect(d.policyId).toBe("command-policy");
  });

  it("deny rules take precedence over allow rules", async () => {
    const p = new CommandPolicyProvider({
      rules: [
        { tool: "bash", pattern: "rm", effect: "deny" },
        { tool: "bash", pattern: "rm", effect: "allow" },
      ],
    });
    const d = await p.aevaluate(req("bash", { command: "rm file.txt" }));
    expect(d.allow).toBe(false);
  });

  it("honours tool scoping", async () => {
    const p = new CommandPolicyProvider({
      rules: [{ tool: "bash", pattern: "git push", effect: "deny" }],
    });
    // The rule targets 'bash' only, so the same command under 'sh' is allowed.
    expect((await p.aevaluate(req("sh", { command: "git push" }))).allow).toBe(true);
    expect((await p.aevaluate(req("bash", { command: "git push origin main" }))).allow).toBe(false);
  });

  it("treats a wildcard tool as all tools", async () => {
    const p = new CommandPolicyProvider({
      rules: [{ pattern: "drop database", effect: "deny" }],
    });
    expect((await p.aevaluate(req("sql", { command: "DROP DATABASE prod" }))).allow).toBe(false);
  });

  it("matches case-insensitively by default", async () => {
    const p = new CommandPolicyProvider({
      rules: [{ tool: "bash", pattern: "sudo", effect: "deny" }],
    });
    expect((await p.aevaluate(req("bash", { command: "SUDO apt install" }))).allow).toBe(false);
  });

  it("supports case-sensitive matching when configured", async () => {
    const p = new CommandPolicyProvider({
      rules: [{ tool: "bash", pattern: "sudo", effect: "deny" }],
      caseSensitive: true,
    });
    expect((await p.aevaluate(req("bash", { command: "SUDO apt install" }))).allow).toBe(true);
  });

  it("falls back to defaultDecision deny when no rule matches", async () => {
    const p = new CommandPolicyProvider({
      rules: [{ tool: "bash", pattern: "git push", effect: "allow" }],
      defaultDecision: "deny",
    });
    const d = await p.aevaluate(req("bash", { command: "ls -la" }));
    expect(d.allow).toBe(false);
    expect(d.reasons[0].code).toBe("oap.command_not_allowed");
  });

  it("applies the default decision when the target field is absent", async () => {
    const p = new CommandPolicyProvider({
      rules: [{ tool: "read_file", pattern: ".", effect: "deny" }],
      defaultDecision: "allow",
    });
    // read_file has no `command` field → default decision.
    expect((await p.aevaluate(req("read_file", { path: "/etc/passwd" }))).allow).toBe(true);
  });

  it("throws on invalid regex at construction", () => {
    expect(() => new CommandPolicyProvider({ rules: [{ pattern: "(unclosed", effect: "deny" }] })).toThrow(
      /invalid regex/
    );
  });

  it("throws on an invalid effect value", () => {
    // @ts-expect-error - deliberately passing a bad effect to exercise validation.
    expect(() => new CommandPolicyProvider({ rules: [{ pattern: "x", effect: "block" }] })).toThrow(
      /effect/
    );
  });
});
