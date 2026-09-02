/**
 * Tool discovery — budgeted catalog and dynamic tool loading.
 *
 * Port of OpenWork CodeMode's budgeted catalog system. When the tool catalog
 * exceeds a token budget, fair allocation across namespaces ensures the agent
 * sees a representative subset of tools while a search mechanism lets it
 * discover more on demand.
 *
 * Quick start:
 *   import { BudgetedCatalog, estimateTokenCost } from "quill.tools.discovery";
 *
 *   const catalog = new BudgetedCatalog(tools, { tokenBudget: 4000 });
 *   const visible = catalog.getVisibleTools(); // Tools that fit in budget
 *   const search = catalog.search("create issue"); // Find specific tools
 */

export { BudgetedCatalog, estimateTokenCost } from "./budgeted_catalog.js";
export type { CatalogTool, CatalogNamespace, BudgetedCatalogOptions } from "./budgeted_catalog.js";
