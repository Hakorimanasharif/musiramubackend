import test from "node:test";
import assert from "node:assert/strict";

// Never connect to a developer or production database in these tests.
process.env.MONGO_URI = "";
process.env.NODE_ENV = "production";
process.env.NETLIFY = "true";
process.env.FRONTEND_URL = "https://dashboard.example.com";
const { handler } = await import("../netlify/functions/api.mjs");
const invoke = (path, extra = {}) => handler({
  httpMethod: "GET", path, headers: { host: "api.example.com" },
  queryStringParameters: {}, body: null, isBase64Encoded: false,
  requestContext: { identity: { sourceIp: "127.0.0.1" } }, ...extra,
}, {});

test("serverless entry responds without starting a server or requiring MongoDB", async () => {
  const response = await invoke("/");
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).message, "CreditLedger API running");
});

test("database failures return 503 rather than exiting the function", async () => {
  for (const path of ["/api/health", "/api/customers"]) {
    const response = await invoke(path);
    assert.equal(response.statusCode, 503);
  }
  assert.equal((await invoke("/")).statusCode, 200);
});

test("CORS allows configured frontend and denies arbitrary websites", async () => {
  const allowed = await invoke("/", { headers: { origin: process.env.FRONTEND_URL } });
  assert.equal(allowed.headers["access-control-allow-origin"], process.env.FRONTEND_URL);
  const denied = await invoke("/", { headers: { origin: "https://untrusted.netlify.app" } });
  assert.equal(denied.headers["access-control-allow-origin"], undefined);
});

test("preflight supports cron authentication without touching MongoDB", async () => {
  const response = await invoke("/api/cron/reminders", {
    httpMethod: "OPTIONS", headers: { origin: process.env.FRONTEND_URL,
      "access-control-request-method": "POST", "access-control-request-headers": "x-cron-secret" },
  });
  assert.equal(response.statusCode, 204);
  assert.match(response.headers["access-control-allow-headers"], /X-Cron-Secret/);
});

test("background reminder worker rejects unauthenticated invocation before database access", async () => {
  const { handler: worker } = await import("../netlify/functions/reminders-background.mjs");
  assert.equal((await worker({ headers: {} }, {})).statusCode, 401);
});


test("production backend permits the local frontend and its login preflight", async () => {
  const origin = "http://localhost:5177";
  const response = await invoke("/", { headers: { origin } });
  assert.equal(response.headers["access-control-allow-origin"], origin);
  assert.equal(response.headers["access-control-allow-credentials"], "true");
  const preflight = await invoke("/api/auth/login", {
    httpMethod: "OPTIONS",
    headers: { origin, "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,authorization" },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], origin);
  const otherPort = await invoke("/", { headers: { origin: "http://localhost:9999" } });
  assert.equal(otherPort.headers["access-control-allow-origin"], undefined);
});
