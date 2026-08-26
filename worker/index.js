import { connect } from "node:net";

const ALLOWED_ORIGINS = new Set([
  "https://lunix.blueberryservices.co.za",
  "null" // local dev via file://
]);

const security = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "0"
};

const cors = { "Access-Control-Allow-Origin": "*" };

const SESSION_RE = /^[A-Z0-9]{6,16}$/;
const MAX_UPLOAD = 2.5 * 1024 * 1024 * 1024;

// this deployment's youtube converter — tools like ytc discover it via /api/config,
// so swapping the converter here is all a self-hoster ever touches.
const YTC_UPSTREAM = "https://ytc.blueberryservices.co.za";

function trustedOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // curl / non-browser / same-origin GET
  return ALLOWED_ORIGINS.has(origin);
}

function validSession(request) {
  const tok = request.headers.get("X-Lunix-Session") || "";
  return SESSION_RE.test(tok);
}

function json(o, status) {
  return new Response(JSON.stringify(o), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...cors, ...security, "Cache-Control": "no-store" }
  });
}

function reject(status, message) {
  return json({ error: message }, status);
}

function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Lunix-Session, X-Wids-Key",
      "Access-Control-Max-Age": "86400",
      ...security
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let p = url.pathname;

    if (p === "/wisp") {
      return handleWisp(request);
    }

    if (p === "/api/bucket" || p.startsWith("/api/bucket/")) {
      if (request.method === "OPTIONS") return preflight();
      if (!trustedOrigin(request)) return reject(403, "cross-origin request denied");
      if (!["GET", "PUT", "DELETE"].includes(request.method)) return reject(405, "method not allowed");

      if (p === "/api/bucket") {
        // list requires a session token
        if (!validSession(request)) return reject(401, "missing or invalid session token");
        const listed = await env.LUNIX.list({ prefix: "user/" });
        const files = listed.objects
          .filter((o) => !o.key.endsWith("/"))
          .map((o) => ({
            name: o.key.slice("user/".length),
            size: o.size,
            modified: o.uploaded ? o.uploaded.toISOString() : null
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return json({ files });
      }

      const raw = p.slice("/api/bucket/".length);
      if (!raw || raw.includes("/") || raw.includes("..")) return reject(400, "bad name");

      if (request.method === "PUT") {
        if (!validSession(request)) return reject(401, "missing or invalid session token");
        const len = parseInt(request.headers.get("Content-Length") || "0", 10);
        if (len > MAX_UPLOAD) return reject(413, "file too large (max 2.5 GiB)");
        await env.LUNIX.put("user/" + raw, request.body);
        const head = await env.LUNIX.head("user/" + raw);
        return json({ name: raw, size: head.size });
      }

      if (request.method === "DELETE") {
        if (!validSession(request)) return reject(401, "missing or invalid session token");
        await env.LUNIX.delete("user/" + raw);
        return json({ deleted: raw });
      }

      // GET download — origin-checked so saved links still work from the sim
      const obj = await env.LUNIX.get("user/" + raw);
      if (!obj) return reject(404, "not found");
      const audioTypes = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".oga": "audio/ogg",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".flac": "audio/flac",
        ".opus": "audio/ogg",
        ".webm": "audio/webm"
      };
      const ext = raw.slice(raw.lastIndexOf(".")).toLowerCase();
      const headers = new Headers(obj.writeHttpMetadata || {});
      headers.set("Content-Type", audioTypes[ext] || "application/octet-stream");
      headers.set("Content-Disposition", 'attachment; filename="' + raw.replace(/"/g, "") + '"');
      headers.set("Content-Length", obj.size);
      headers.set("Cache-Control", "no-store");
      headers.set("Access-Control-Allow-Origin", "*");
      for (const [k, v] of Object.entries(security)) headers.set(k, v);
      return new Response(obj.body, { headers });
    }

    // ---- PocketWIDS sensor ingest + readout ----
    if (p === "/api/wids") {
      if (request.method === "OPTIONS") return preflight();

      const EVENTS_KEY = "user/wids-events.jsonl";
      const MAX_EVENTS = 1000;

      async function readEvents() {
        const obj = await env.LUNIX.get(EVENTS_KEY);
        if (!obj) return [];
        const text = await obj.text();
        return text.split("\n").filter((l) => l.trim()).map((l) => {
          try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean);
      }

      // sensor ingest — shared secret, no origin/token dance (devices have neither)
      if (request.method === "POST") {
        const key = request.headers.get("X-Wids-Key") || "";
        if (!env.WIDS_KEY || key !== env.WIDS_KEY) return reject(401, "bad sensor key");
        let ev;
        try { ev = await request.json(); } catch { return reject(400, "bad json"); }
        const rec = {
          type: String(ev.type || "event").slice(0, 32),
          detail: String(ev.detail || "").slice(0, 200),
          channel: Number(ev.channel) || null,
          rssi: Number.isFinite(ev.rssi) ? Math.round(ev.rssi) : null,
          sensor: String(ev.sensor || "stick").slice(0, 32),
          ts: Date.now()
        };
        const events = await readEvents();
        events.push(rec);
        const trimmed = events.slice(-MAX_EVENTS);
        await env.LUNIX.put(EVENTS_KEY, trimmed.map((e) => JSON.stringify(e)).join("\n"));
        return json({ ok: true, total: trimmed.length });
      }

      // readout — same-origin from the sim, trusted origins elsewhere
      if (request.method === "GET") {
        if (!trustedOrigin(request)) return reject(403, "cross-origin request denied");
        const q = new URL(request.url).searchParams;
        const limit = Math.min(parseInt(q.get("limit") || "50", 10) || 50, MAX_EVENTS);
        const type = q.get("type");
        let events = await readEvents();
        if (type) events = events.filter((e) => e.type === type);
        return json({ count: events.length, events: events.slice(-limit).reverse() });
      }

      return reject(405, "method not allowed");
    }

    // ---- config discovery — installed tools learn this deployment's infra ----
    if (p === "/api/config") {
      if (request.method === "OPTIONS") return preflight();
      if (!trustedOrigin(request)) return reject(403, "cross-origin request denied");
      if (request.method !== "GET") return reject(405, "method not allowed");
      return json({
        ytcProxy: "/api/ytc",
        ytcUpstream: YTC_UPSTREAM
      });
    }

    // ---- ytc proxy — youtube converter relay ----
    // the sim calls /api/ytc/* same-origin; the worker forwards to the self-hosted
    // yt-dlp+ffmpeg converter, which has no CORS of its own.
    if (p.startsWith("/api/ytc/")) {
      if (request.method === "OPTIONS") return preflight();
      if (!trustedOrigin(request)) return reject(403, "cross-origin request denied");
      if (!["GET", "POST"].includes(request.method)) return reject(405, "method not allowed");

      const sub = p.slice("/api/ytc/".length); // info | jobs | jobs/<id> | download/<id>
      if (!sub || sub.includes("..")) return reject(400, "bad path");
      const target = sub.startsWith("download/")
        ? YTC_UPSTREAM + "/" + sub
        : YTC_UPSTREAM + "/api/" + sub;

      const init = { method: request.method, redirect: "follow" };
      if (request.method === "POST") {
        init.body = request.body;
        init.headers = { "Content-Type": request.headers.get("Content-Type") || "application/json" };
      }

      let upstream;
      try {
        upstream = await fetch(target, init);
      } catch {
        return reject(502, "converter unreachable");
      }

      const headers = new Headers();
      headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/octet-stream");
      const cd = upstream.headers.get("Content-Disposition");
      if (cd) headers.set("Content-Disposition", cd);
      headers.set("Cache-Control", "no-store");
      for (const [k, v] of Object.entries(security)) headers.set(k, v);
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    const mimes = {
      "index.html": "text/html; charset=utf-8",
      "assets/lunix_core.wasm": "application/wasm",
      "v86.js": "text/javascript",
      "v86.wasm": "application/wasm",
      "alpine.iso": "application/octet-stream",
      "bios/seabios.bin": "application/octet-stream",
      "bios/vgabios.bin": "application/octet-stream"
    };

    if (p === "/" || p === "/index.html") p = "/index.html";
    const key = p.slice(1);
    if (mimes[key] || key.endsWith(".slux")) {
      const obj = await env.LUNIX.get(key);
      if (!obj) return new Response("not found", { status: 404, headers: security });
      const headers = new Headers(obj.writeHttpMetadata || {});
      headers.set("Content-Type", mimes[key] || "text/plain; charset=utf-8");
      headers.set("Cache-Control", key === "index.html" ? "no-cache" : key.endsWith(".slux") || key.startsWith("assets/") ? "public, max-age=300" : "public, max-age=31536000, immutable");
      headers.set("Content-Length", obj.size);
      for (const [k, v] of Object.entries(security)) headers.set(k, v);
      return new Response(obj.body, { headers });
    }

    return new Response("not found", { status: 404, headers: security });
  }
};

function sendFrame(ws, type, streamId, payload) {
  const pl = payload ? new Uint8Array(payload) : new Uint8Array(0);
  const out = new Uint8Array(5 + pl.length);
  const v = new DataView(out.buffer);
  v.setUint8(0, type);
  v.setUint32(1, streamId, true);
  if (pl.length) out.set(pl, 5);
  ws.send(out.buffer);
}

function handleWisp(request) {
  const upgrade = request.headers.get("Upgrade");
  if (upgrade !== "websocket") return new Response("expected websocket upgrade", { status: 426 });
  const pair = new WebSocketPair();
  const server = pair[1];
  server.accept();
  const sockets = new Map();
  let nextStream = 1;

  server.addEventListener("message", (event) => {
    const data = event.data;
    const buf = new Uint8Array(data);
    if (buf.length < 5) return;
    const view = new DataView(data);
    const type = buf[0];
    const streamId = view.getUint32(1, true);

    if (type === 0x01) {
      // CONNECT
      const proto = buf[5];
      const port = view.getUint16(6, true);
      const host = new TextDecoder().decode(buf.subarray(8));
      let socket = null;
      connect({ hostname: host, port: port }).then((sock) => {
        socket = sock;
        sockets.set(streamId, sock);
        sendFrame(server, 0x01, streamId);
        const cwnd = new Uint32Array([0x7fffffff]);
        sendFrame(server, 0x03, streamId, cwnd.buffer);
        sock.on("data", (d) => {
          sendFrame(server, 0x02, streamId, d);
        });
        sock.on("end", () => {
          sendFrame(server, 0x04, streamId, 0x02);
          sockets.delete(streamId);
        });
        sock.on("close", () => {
          sendFrame(server, 0x04, streamId, 0x02);
          sockets.delete(streamId);
        });
        sock.on("error", () => {
          sendFrame(server, 0x04, streamId, 0x04);
          sockets.delete(streamId);
        });
      }).catch(() => {
        sendFrame(server, 0x04, streamId, 0x04);
      });
    } else if (type === 0x02) {
      // DATA
      const sock = sockets.get(streamId);
      if (sock) {
        try { sock.write(buf.subarray(5)); } catch (e) {}
      }
    } else if (type === 0x04) {
      // CLOSE
      const sock = sockets.get(streamId);
      if (sock) {
        try { sock.end(); } catch (e) {}
      }
      sockets.delete(streamId);
    }
  });

  server.addEventListener("close", () => {
    for (const s of sockets.values()) { try { s.end(); } catch (e) {} }
    sockets.clear();
  });

  return new Response(null, { status: 101, webSocket: server });
}