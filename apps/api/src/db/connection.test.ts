import { readFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { createSecureContext, TLSSocket, type SecureContext } from "node:tls";
import { afterEach, expect, it } from "vitest";
import { databaseConnection } from "./connection.ts";
import { Store } from "./store.ts";

const fixtures = new URL("../../tests/fixtures/tls/", import.meta.url);
const localhostCert = readFileSync(new URL("localhost.crt", fixtures), "utf8");
const otherCert = readFileSync(new URL("other.crt", fixtures), "utf8");
const localhostContext = createSecureContext({
  cert: localhostCert,
  key: readFileSync(new URL("localhost.key", fixtures)),
});
const otherContext = createSecureContext({
  cert: otherCert,
  key: readFileSync(new URL("other.key", fixtures)),
});
const servers = new Set<Server>();
const sockets = new Set<Socket>();

afterEach(async () => {
  for (const socket of sockets) {
    socket.destroy();
  }
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  sockets.clear();
  servers.clear();
});

// Minimal PostgreSQL SSL negotiation and startup, using real TCP/TLS and pg.
async function postgresServer(context?: SecureContext) {
  let startupReceived = false;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("data", () => {
      if (!context) {
        socket.end("N");
        return;
      }
      socket.write("S");
      const tls = new TLSSocket(socket, { isServer: true, secureContext: context });
      sockets.add(tls);
      tls.on("error", () => tls.destroy());
      tls.once("data", () => {
        startupReceived = true;
        // AuthenticationOk, followed by ReadyForQuery (idle).
        tls.write(Buffer.from([82, 0, 0, 0, 8, 0, 0, 0, 0, 90, 0, 0, 0, 5, 73]));
        tls.once("data", () => tls.end());
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.add(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Missing server address");
  }
  return {
    url: `postgresql://test:test@localhost:${address.port}/test`,
    startupReceived: () => startupReceived,
  };
}

it("connects with a trusted certificate and matching hostname", async () => {
  const server = await postgresServer(localhostContext);
  const config = databaseConnection({
    NODE_ENV: "production",
    DATABASE_URL: `${server.url}?sslmode=verify-full`,
    DATABASE_SSL_CA: localhostCert,
  });
  const store = new Store(config.databaseUrl, config.databaseSsl);
  try {
    const client = await store.pool.connect();
    client.release();
    expect(server.startupReceived()).toBe(true);
  } finally {
    await store.pool.end();
  }
});

it.each([
  { name: "untrusted certificate", context: localhostContext, ca: undefined, error: "self-signed" },
  { name: "hostname mismatch", context: otherContext, ca: otherCert, error: "Hostname/IP" },
  {
    name: "IP address mismatch",
    context: localhostContext,
    ca: localhostCert,
    error: "Hostname/IP",
    host: "127.0.0.1",
  },
  {
    name: "plaintext-only server",
    context: undefined,
    ca: undefined,
    error: "does not support SSL",
  },
])("rejects $name before sending database credentials", async ({ context, ca, error, host }) => {
  const server = await postgresServer(context);
  const config = databaseConnection({
    NODE_ENV: "production",
    DATABASE_URL: host ? server.url.replace("localhost", host) : server.url,
    ...(ca ? { DATABASE_SSL_CA: ca } : {}),
  });
  const store = new Store(config.databaseUrl, config.databaseSsl);
  try {
    await expect(store.pool.connect()).rejects.toThrow(error);
    expect(server.startupReceived()).toBe(false);
  } finally {
    await store.pool.end();
  }
});
