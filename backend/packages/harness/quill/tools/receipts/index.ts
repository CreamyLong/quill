/**
 * Tool receipt system — deterministic verification for agent tool calls.
 *
 * Port of DeerFlow 2.0's tool receipt system. Every tool call gets an
 * immutable receipt that the agent can cite in its output. Citations
 * like [r2] or [r2 write_file] can be verified deterministically.
 *
 * Quick start:
 *   import { buildLedger, verifyCitations, renderLedger } from "quill.tools.receipts";
 *
 *   // After a run, build the ledger from tool messages:
 *   const ledger = buildLedger(toolMessages);
 *
 *   // Inject the ledger into the model context:
 *   const ledgerText = renderLedger(ledger.receipts, 2000).rendered;
 *
 *   // Verify citations in the agent's output:
 *   const verification = verifyCitations(agentOutput, ledger);
 *   if (!verification.valid) {
 *     console.log("Invalid citations:", verification.invalidCitations);
 *   }
 */

export {
  createReceipt,
  buildLedger,
  renderLedger,
  verifyCitations,
} from "./receipt.js";

export type {
  ToolReceipt,
  ReceiptLedger,
  CitationsVerification,
} from "./receipt.js";
