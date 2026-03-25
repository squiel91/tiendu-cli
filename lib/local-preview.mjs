import { createServer } from "node:http";
import { Readable } from "node:stream";

const DEFAULT_PORT = 9292;
const MAX_PORT_ATTEMPTS = 20;
const MAX_SSE_CLIENTS = 20;
const RELOAD_DEBOUNCE_MS = 150;
const HEARTBEAT_INTERVAL_MS = 15_000;
const PROXY_TIMEOUT_MS = 30_000;
const MAX_PROXY_REQUEST_BODY_BYTES = 2 * 1024 * 1024;

const LIVE_RELOAD_PATH = "/__tiendu__/livereload.js";
const EVENTS_PATH = "/__tiendu__/events";

const LIVE_RELOAD_SCRIPT = `const source = new EventSource(${JSON.stringify(EVENTS_PATH)});
let reloadTimer = null;

source.addEventListener("reload", () => {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => window.location.reload(), 60);
});
`;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const readRequestBody = async (request) => {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_PROXY_REQUEST_BODY_BYTES) {
      const error = new Error("Local preview request body is too large.");
      error.statusCode = 413;
      throw error;
    }

    chunks.push(chunk);
  }

  if (chunks.length === 0) return undefined;
  return Buffer.concat(chunks);
};

const createForwardHeaders = (request, previewHostname) => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (value == null) continue;

    const normalizedName = name.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(normalizedName) ||
      normalizedName === "host" ||
      normalizedName === "origin" ||
      normalizedName === "referer" ||
      normalizedName === "content-length"
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(name, entry);
      }
      continue;
    }

    headers.set(name, value);
  }

  headers.set("host", previewHostname);
  headers.set("x-forwarded-host", previewHostname);

  return headers;
};

const isHtmlResponse = (headers) =>
  (headers.get("content-type") ?? "").toLowerCase().includes("text/html");

const isHtmlDocument = (html) => /<html\b|<!doctype\s+html/i.test(html);

const injectLiveReloadScript = (html) => {
  if (html.includes(LIVE_RELOAD_PATH)) return html;
  if (!isHtmlDocument(html)) return html;

  const scriptTag = `<script type="module" src="${LIVE_RELOAD_PATH}"></script>`;

  if (html.includes("</head>")) {
    return html.replace("</head>", `${scriptTag}</head>`);
  }

  if (html.includes("</body>")) {
    return html.replace("</body>", `${scriptTag}</body>`);
  }

  return `${html}${scriptTag}`;
};

const rewriteSetCookie = (cookieValue) =>
  cookieValue
    .replace(/;\s*Secure/gi, "")
    .replace(/;\s*Domain=[^;]+/gi, "");

const rewriteLocationHeader = (locationValue, localOrigin, previewOrigin, upstreamOrigin) => {
  if (!locationValue) return null;

  try {
    const locationUrl = new URL(locationValue, previewOrigin);
    if (
      locationUrl.origin === previewOrigin.origin ||
      locationUrl.origin === upstreamOrigin.origin
    ) {
      return `${localOrigin.origin}${locationUrl.pathname}${locationUrl.search}${locationUrl.hash}`;
    }

    return locationValue;
  } catch {
    return locationValue;
  }
};

const writeResponseHeaders = (response, serverResponse, context) => {
  const { localOrigin, previewOrigin, upstreamOrigin } = context;

  for (const [name, value] of response.headers) {
    const normalizedName = name.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(normalizedName) ||
      normalizedName === "content-length" ||
      normalizedName === "content-encoding" ||
      normalizedName === "set-cookie"
    ) {
      continue;
    }

    if (normalizedName === "location") {
      const rewritten = rewriteLocationHeader(
        value,
        localOrigin,
        previewOrigin,
        upstreamOrigin,
      );
      if (rewritten) serverResponse.setHeader(name, rewritten);
      continue;
    }

    serverResponse.setHeader(name, value);
  }

  const setCookies = response.headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    serverResponse.setHeader(
      "set-cookie",
      setCookies.map(rewriteSetCookie),
    );
  }
};

const listenOnAvailablePort = (server, preferredPort) =>
  new Promise((resolve, reject) => {
    let currentPort = preferredPort;

    const tryListen = () => {
      const onError = (error) => {
        server.off("listening", onListening);

        if (error?.code === "EADDRINUSE" && currentPort < preferredPort + MAX_PORT_ATTEMPTS) {
          currentPort += 1;
          tryListen();
          return;
        }

        reject(error);
      };

      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Could not determine local preview port."));
          return;
        }

        resolve(address.port);
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(currentPort, "localhost");
    };

    tryListen();
  });

export const startLocalPreviewServer = async ({
  apiBaseUrl,
  previewHostname,
  port = DEFAULT_PORT,
}) => {
  const upstreamOrigin = new URL(apiBaseUrl);
  const previewOrigin = new URL(`${upstreamOrigin.protocol}//${previewHostname}`);
  const sseClients = new Set();
  let reloadTimer = null;

  const server = createServer(async (request, response) => {
    if (!request.url) {
      response.writeHead(400);
      response.end("Missing request URL");
      return;
    }

    const localOrigin = new URL(`http://${request.headers.host ?? `127.0.0.1:${port}`}`);
    const requestUrl = new URL(request.url, localOrigin);

    if (requestUrl.pathname === LIVE_RELOAD_PATH) {
      response.writeHead(200, {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(LIVE_RELOAD_SCRIPT);
      return;
    }

    if (requestUrl.pathname === EVENTS_PATH) {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      response.write("event: connected\ndata: ok\n\n");

      if (sseClients.size >= MAX_SSE_CLIENTS) {
        const oldestClient = sseClients.values().next().value;
        oldestClient?.end();
        if (oldestClient) {
          sseClients.delete(oldestClient);
        }
      }

      sseClients.add(response);

      request.on("close", () => {
        sseClients.delete(response);
      });
      return;
    }

    const targetUrl = new URL(requestUrl.pathname + requestUrl.search, upstreamOrigin);

    try {
      const body = await readRequestBody(request);
      const upstreamResponse = await fetch(targetUrl, {
        method: request.method,
        headers: createForwardHeaders(request, previewHostname),
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      });

      if (isHtmlResponse(upstreamResponse.headers)) {
        const html = injectLiveReloadScript(await upstreamResponse.text());
        writeResponseHeaders(upstreamResponse, response, {
          localOrigin,
          previewOrigin,
          upstreamOrigin,
        });
        response.statusCode = upstreamResponse.status;
        response.setHeader("cache-control", "no-store");
        response.setHeader("content-length", Buffer.byteLength(html, "utf-8"));
        response.end(html);
        return;
      }

      writeResponseHeaders(upstreamResponse, response, {
        localOrigin,
        previewOrigin,
        upstreamOrigin,
      });
      response.statusCode = upstreamResponse.status;

      if (!upstreamResponse.body) {
        response.end();
        return;
      }

      const proxyStream = Readable.fromWeb(upstreamResponse.body);
      proxyStream.on("error", (error) => {
        console.warn(`Local preview proxy stream error: ${error.message}`);
        response.destroy(error);
      });
      proxyStream.pipe(response);
    } catch (error) {
      const statusCode = error.statusCode ?? 502;
      response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
      response.end(`Local preview proxy error: ${error.message}`);
    }
  });

  const heartbeat = setInterval(() => {
    for (const client of sseClients) {
      client.write(": ping\n\n");
    }
  }, HEARTBEAT_INTERVAL_MS);

  const boundPort = await listenOnAvailablePort(server, port);

  return {
    url: `http://localhost:${boundPort}/`,
    notifyReload() {
      if (reloadTimer) clearTimeout(reloadTimer);

      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        for (const client of sseClients) {
          client.write("event: reload\ndata: now\n\n");
        }
      }, RELOAD_DEBOUNCE_MS);
    },
    async close() {
      if (reloadTimer) clearTimeout(reloadTimer);
      clearInterval(heartbeat);

      for (const client of sseClients) {
        client.end();
      }
      sseClients.clear();

      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
};
