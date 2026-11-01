// @ts-check
// Local TLS front for the WebKit project (V13-QA-016). Playwright's WebKit on Linux drops a `Secure` cookie on
// plain-http localhost, where Chromium and Firefox keep it, so the session cookie (lib/auth/session.ts, `secure: true`)
// never reached WebKit and every signed-in test failed. WebKit therefore reaches the same started app through this
// HTTPS front. The app and its cookie are unchanged: nothing is weakened for a test engine.
//
// It forwards every request unchanged to the app (method, path, headers including Host, and body) and adds
// `x-forwarded-proto: https`; responses come back unchanged. The certificate is a throwaway self-signed one made by the
// CI job with openssl (V13_E2E_TLS_CERT, V13_E2E_TLS_KEY; never committed, never uploaded). Loopback only. Test harness
// only: PRODUCTION_SUBSTITUTION_REQUIRED does not apply, because production terminates TLS at its own ingress.
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

const cert = process.env.V13_E2E_TLS_CERT;
const key = process.env.V13_E2E_TLS_KEY;
const port = Number(process.env.V13_E2E_TLS_PORT || 3443);
const target = new URL(process.env.V13_E2E_TLS_TARGET || "http://127.0.0.1:3100");
if (!cert || !key)
  throw new Error("V13_E2E_TLS_CERT and V13_E2E_TLS_KEY must name the certificate and key files");
// Loopback only, both ways (ARCH conditions on #152): it listens on 127.0.0.1 and forwards to an http app on 127.0.0.1.
if (
  target.hostname !== "127.0.0.1" ||
  target.protocol !== "http:" ||
  target.pathname !== "/" ||
  target.search
)
  throw new Error("the TLS front forwards to the started app on http://127.0.0.1 only");

const server = https.createServer({ cert: readFileSync(cert), key: readFileSync(key) }, (req, res) => {
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, "x-forwarded-proto": "https" },
    },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.rawHeaders);
      answer.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("bad gateway");
  });
  req.pipe(upstream);
});

server.listen(port, "127.0.0.1");
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"]))
  process.on(signal, () => server.close(() => process.exit(0)));
