/**
 * Custom fetch implementation that routes HTTP(S) requests through an HTTP proxy
 * using `node:https` and `node:http` modules, bypassing undici's proxy issues.
 *
 * Usage: pass to tsdav DAVClient as the `fetch` parameter.
 */
import http from "node:http";
import tls from "node:tls";
import net from "node:net";

// Detect proxy from environment
const HTTPS_PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const HTTP_PROXY = process.env.HTTP_PROXY || process.env.http_proxy || "";
const NO_PROXY = (process.env.NO_PROXY || process.env.no_proxy || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function shouldProxy(url: string): boolean {
  if (!HTTPS_PROXY && !HTTP_PROXY) return false;
  try {
    const u = new URL(url);
    const host = u.hostname;
    for (const pattern of NO_PROXY) {
      if (!pattern) continue;
      if (pattern.startsWith("*.")) {
        if (host.endsWith(pattern.slice(1))) return false;
      } else if (pattern.startsWith("*")) {
        if (host.endsWith(pattern.slice(1))) return false;
      } else if (host === pattern || host.endsWith(`.${pattern}`)) {
        return false;
      }
      if (pattern.includes("*")) {
        const regex = new RegExp("^" + pattern.replace(/\*/g, "[^.]*") + "$");
        if (regex.test(host)) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Convert headers from RequestInit to a plain record */
function headersToRecord(headers: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (Array.isArray(headers)) {
    for (const [k, v] of headers) {
      if (typeof k === "string" && v != null) out[k] = String(v);
    }
  } else if (typeof headers.forEach === "function") {
    headers.forEach((v: any, k: any) => {
      if (k != null) out[String(k)] = v != null ? String(v) : "";
    });
  } else {
    for (const k of Object.keys(headers)) {
      const v = headers[k];
      if (v != null) out[k] = String(v);
    }
  }
  return out;
}

/**
 * A drop-in replacement for the global `fetch` function that routes
 * HTTP(S) requests through an HTTP CONNECT proxy.
 *
 * If proxyUrl is not provided, reads from HTTPS_PROXY / HTTP_PROXY env vars.
 */
export function createProxyFetch(proxyUrl?: string): typeof fetch {
  const effectiveProxyUrl = proxyUrl || HTTPS_PROXY || HTTP_PROXY;
  if (!effectiveProxyUrl) {
    return fetch;
  }

  let proxyHost: string, proxyPort: number;
  try {
    const pu = new URL(effectiveProxyUrl);
    proxyHost = pu.hostname;
    proxyPort = parseInt(pu.port, 10) || 10808;
  } catch {
    console.warn(
      `[proxy-fetch] Invalid proxy URL: ${proxyUrl}, using native fetch`,
    );
    return fetch;
  }

  return async function proxyFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const url = new URL(urlStr);

    // Check NO_PROXY
    try {
      const host = url.hostname;
      for (const pattern of NO_PROXY) {
        if (!pattern) continue;
        if (pattern.startsWith("*.")) {
          if (host.endsWith(pattern.slice(1))) return fetch(input, init);
        } else if (pattern.startsWith("*")) {
          if (host.endsWith(pattern.slice(1))) return fetch(input, init);
        } else if (host === pattern || host.endsWith(`.${pattern}`)) {
          return fetch(input, init);
        }
        if (pattern.includes("*")) {
          const regex = new RegExp("^" + pattern.replace(/\*/g, "[^.]*") + "$");
          if (regex.test(host)) return fetch(input, init);
        }
      }
    } catch {
      // ignore
    }

    const method = init?.method || "GET";
    const reqHeaders = headersToRecord(init?.headers);
    const body = init?.body as string | undefined;
    const isHttps = url.protocol === "https:";
    const targetPort = url.port || (isHttps ? "443" : "80");

    return new Promise((resolve, reject) => {
      // Step 1: Establish CONNECT tunnel through proxy
      const proxyReq = http.request({
        hostname: proxyHost,
        port: proxyPort,
        method: "CONNECT",
        path: `${url.hostname}:${targetPort}`,
        headers: {
          Host: `${url.hostname}:${targetPort}`,
          "Proxy-Connection": "Keep-Alive",
        },
        timeout: 30000,
      });

      proxyReq.on("connect", (_res, socket) => {
        let sendSocket: net.Socket;

        if (isHttps) {
          // For HTTPS: upgrade socket to TLS
          sendSocket = tls.connect({
            socket: socket as net.Socket,
            host: url.hostname,
            servername: url.hostname,
            rejectUnauthorized: false,
          });
          (sendSocket as tls.TLSSocket).on("secureConnect", () => {
            sendRequest(sendSocket);
          });
        } else {
          // For HTTP: use the raw socket directly (no TLS)
          sendSocket = socket as net.Socket;
          sendRequest(sendSocket);
        }

        function sendRequest(sock: net.Socket) {
          const reqPath = url.pathname + url.search;

          // Build request string
          let reqStr = `${method} ${reqPath} HTTP/1.1\r\n`;
          reqStr += `Host: ${url.hostname}\r\n`;
          for (const [k, v] of Object.entries(reqHeaders)) {
            if (v != null) {
              reqStr += `${k}: ${v}\r\n`;
            }
          }
          if (body) {
            reqStr += `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n`;
          }
          reqStr += "Connection: close\r\n";
          reqStr += "\r\n";
          if (body) {
            reqStr += body;
          }

          sock.write(reqStr);
        }

        // Collect response
        let responseData = "";
        let responseHeaders: Record<string, string> = {};
        let statusCode = 0;
        let statusText = "";
        let headersParsed = false;

        sendSocket.on("data", (data: Buffer) => {
          responseData += data.toString();

          if (!headersParsed) {
            const headerEnd = responseData.indexOf("\r\n\r\n");
            if (headerEnd !== -1) {
              headersParsed = true;
              const headerBlock = responseData.substring(0, headerEnd);
              const lines = headerBlock.split("\r\n");
              const statusLine = lines[0];
              const statusMatch = statusLine.match(
                /HTTP\/\d+\.\d+\s+(\d+)\s+(.+)/,
              );
              if (statusMatch) {
                statusCode = parseInt(statusMatch[1], 10);
                statusText = statusMatch[2];
              }
              for (let i = 1; i < lines.length; i++) {
                const colonIdx = lines[i].indexOf(":");
                if (colonIdx > 0) {
                  const k = lines[i].substring(0, colonIdx).trim();
                  const v = lines[i].substring(colonIdx + 1).trim();
                  responseHeaders[k] = v;
                }
              }
              // Keep only the body
              responseData = responseData.substring(headerEnd + 4);
            }
          }
        });

        sendSocket.on("end", () => {
          // Handle chunked transfer encoding
          let body = responseData;
          const transferEncoding =
            responseHeaders["transfer-encoding"] ||
            responseHeaders["Transfer-Encoding"] ||
            "";
          if (transferEncoding.toLowerCase() === "chunked") {
            try {
              body = decodeChunkedBody(responseData);
            } catch {
              // If chunked decoding fails, use raw data
            }
            delete responseHeaders["transfer-encoding"];
            delete responseHeaders["Transfer-Encoding"];
          }

          const res = new Response(body, {
            status: statusCode || 502,
            statusText: statusText || "Bad Gateway",
            headers: responseHeaders,
          });
          resolve(res);
        });

        sendSocket.on("error", (err) => {
          reject(new Error(`Socket error: ${err.message}`));
        });
      });

      proxyReq.on("error", (err) => {
        reject(new Error(`Proxy CONNECT error: ${err.message}`));
      });

      proxyReq.on("timeout", () => {
        proxyReq.destroy();
        reject(new Error("Proxy CONNECT timeout"));
      });

      proxyReq.end();
    });
  };
}

/** Decode HTTP chunked transfer encoding */
function decodeChunkedBody(data: string): string {
  const out: string[] = [];
  let pos = 0;
  while (pos < data.length) {
    const lineEnd = data.indexOf("\r\n", pos);
    if (lineEnd === -1) break;
    const chunkSize = parseInt(data.substring(pos, lineEnd), 16);
    if (isNaN(chunkSize)) break;
    if (chunkSize === 0) break;
    pos = lineEnd + 2;
    out.push(data.substring(pos, pos + chunkSize));
    pos += chunkSize + 2;
  }
  return out.join("");
}
