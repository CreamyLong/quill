/**
 * Configuration for the LLM circuit breaker used by error-handling middleware.
 */

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before tripping the circuit. */
  failureThreshold: number;
  /** Time in seconds before attempting to recover the circuit. */
  recoveryTimeoutSec: number;
}

/**
 * Build a CircuitBreakerConfig from partial input, applying defaults.
 */
export function buildCircuitBreakerConfig(
  input: Partial<CircuitBreakerConfig> = {}
): CircuitBreakerConfig {
  return {
    failureThreshold: input.failureThreshold ?? 5,
    recoveryTimeoutSec: input.recoveryTimeoutSec ?? 60,
  };
}
