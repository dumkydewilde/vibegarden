import { AsyncLocalStorage } from "node:async_hooks";

type McpRequestProps = Record<string, unknown>;

const mcpRequestContext = new AsyncLocalStorage<McpRequestProps>();

/**
 * Preserves OAuth-issued MCP props across the asynchronous transport dispatch
 * without sharing mutable state between concurrent Worker requests.
 */
export function runWithMcpRequestProps<T>(props: McpRequestProps, callback: () => T): T {
  return mcpRequestContext.run(props, callback);
}

export function getMcpRequestProps(): McpRequestProps | undefined {
  return mcpRequestContext.getStore();
}
