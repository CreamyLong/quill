import process from "node:process";

export interface GatewayConfig {
  /** Host to bind the gateway server */
  host: string;
  /** Port to bind the gateway server */
  port: number;
  /** Enable Swagger/ReDoc/OpenAPI endpoints */
  enableDocs: boolean;
}

let _gatewayConfig: GatewayConfig | null = null;

/**
 * Get gateway config, loading from environment if available.
 */
export function getGatewayConfig(): GatewayConfig {
  if (_gatewayConfig === null) {
    _gatewayConfig = {
      host: process.env.GATEWAY_HOST ?? "0.0.0.0",
      port: Number.parseInt(process.env.GATEWAY_PORT ?? "8001", 10),
      enableDocs: (process.env.GATEWAY_ENABLE_DOCS ?? "true").toLowerCase() === "true",
    };
  }
  return _gatewayConfig;
}
