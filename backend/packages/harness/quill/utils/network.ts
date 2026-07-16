/**
 * Thread-safe port allocator for concurrent environments.
 *
 * Mirrors `quill.utils.network` from the Python backend.
 */

import net from "node:net";

function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}

export class PortAllocator {
  private lock = Promise.resolve();
  private reservedPorts = new Set<number>();

  private async withLock<T>(fn: () => T): Promise<T> {
    const release = await this.lock;
    this.lock = (async () => {
      await release;
      return undefined;
    })();
    try {
      return fn();
    } finally {
      this.lock = Promise.resolve();
    }
  }

  /**
   * Allocate an available port in a thread-safe manner.
   */
  async allocate(startPort = 8080, maxRange = 100): Promise<number> {
    return this.withLock(async () => {
      for (let port = startPort; port < startPort + maxRange; port++) {
        if (this.reservedPorts.has(port)) {
          continue;
        }
        if (await checkPortAvailable(port)) {
          this.reservedPorts.add(port);
          return port;
        }
      }
      throw new Error(`No available port found in range ${startPort}-${startPort + maxRange}`);
    });
  }

  /**
   * Release a previously allocated port.
   */
  release(port: number): void {
    this.reservedPorts.delete(port);
  }

  /**
   * Allocate a port and automatically release it when the callback finishes.
   */
  async withPort<T>(
    fn: (port: number) => T | Promise<T>,
    startPort = 8080,
    maxRange = 100
  ): Promise<T> {
    const port = await this.allocate(startPort, maxRange);
    try {
      return await fn(port);
    } finally {
      this.release(port);
    }
  }
}

const globalPortAllocator = new PortAllocator();

/**
 * Get a free port in a thread-safe manner using the global allocator.
 */
export function getFreePort(startPort = 8080, maxRange = 100): Promise<number> {
  return globalPortAllocator.allocate(startPort, maxRange);
}

/**
 * Release a previously allocated port from the global allocator.
 */
export function releasePort(port: number): void {
  globalPortAllocator.release(port);
}
