/**
 * @module proxy
 * PAKT proxy tool-catalog optimization modes.
 *
 * Exports:
 * - `slim` mode — lossless-in-spirit compression of tool JSON schemas
 * - `search` facade — 3-tool catalog facade (search_tools / get_tool_schema / call_tool)
 */

export { slimTool, slimTools, applySlimMode, truncateAtSentence } from './slim.js';
export { ToolCatalog, FACADE_TOOL_DEFINITIONS, handleFacadeRequest } from './catalog.js';
export type { FacadeHandleResult } from './catalog.js';
export type {
  ProviderTool,
  ToolInputSchema,
  ToolSchemaProperty,
  SlimToolOptions,
  ToolSlimSavings,
  CatalogEntry,
  CatalogSearchResult,
  FacadeToolName,
} from './types.js';
