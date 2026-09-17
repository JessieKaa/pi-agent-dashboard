/**
 * createTestServer — boot a real DashboardServer on OS-assigned ports for
 * integration tests, with safe defaults (no auto-shutdown, no tunnel).
 *
 * Use with the `setup-home` vitest setupFile (in @blackbelt-technology/pi-dashboard-shared/test-support)
 * so that HOME is also isolated.
 *
 * Example:
 *   const { server, httpPort, piPort, stop } = await createTestServer();
 *   const res = await fetch(`http://127.0.0.1:${httpPort}/api/health`);
 *   ...
 *   await stop();
 */
import { createServer, type DashboardServer, type ServerConfig } from "../server.js";

export interface TestServerHandle {
  server: DashboardServer;
  httpPort: number;
  piPort: number;
  stop: () => Promise<void>;
}

export type TestServerOverrides = Partial<ServerConfig>;

const DEFAULTS: ServerConfig = {
  port: 0,
  piPort: 0,
  host: "127.0.0.1",
  // The corpus dials `ws://127.0.0.1:<piPort>`; TCP is opt-in in production
  // (task 8.1) but is still a supported transport, so tests bind it.
  gatewayTcp: true,
  dev: true,
  autoShutdown: false,
  shutdownIdleSeconds: 999,
  tunnel: false,
};

export async function createTestServer(
  overrides: TestServerOverrides = {},
): Promise<TestServerHandle> {
  const config: ServerConfig = { ...DEFAULTS, ...overrides };
  // Boot with API-only static serving: no clientDistOverride is passed, and
  // `DASHBOARD_CLIENT_DIST_DIR` is deleted so `/api/health.clientBuild` is
  // deterministically `not-served` regardless of builds/installs on the
  // runner. Static-serving integration tests instead pass
  // `clientDistOverride` explicitly. See change:
  // optimize-client-bootstrap-and-bundle-coherence (P0).
  const server = await createServer(config, { clientDistOverride: null });
  await server.start();

  const httpPort = server.httpPort();
  const piPort = server.piPort();
  if (httpPort == null || piPort == null) {
    await server.stop();
    throw new Error(
      `createTestServer: failed to resolve ports (httpPort=${httpPort}, piPort=${piPort})`,
    );
  }

  return {
    server,
    httpPort,
    piPort,
    stop: async () => {
      try {
        await server.stop();
      } catch {
        // best-effort — tests may race on shutdown
      }
    },
  };
}
