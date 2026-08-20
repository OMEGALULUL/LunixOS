import { connect } from "node:net";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let p = url.pathname;

    const security = {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    };

    const cors = { "Access-Control-Allow-Origin": "*" };

    if (p === "/wisp") {
      return handleWisp(request);
    }

    if (p === "/api/bucket") {
      if (request.method === "OPTIONS") return preflight();
      const listed = await env.LUNIX.list({ prefix: "user/" });
      const files = listed.objects
        .filter((o) => !o.key.endsWith("/"))
        .map((o) => ({
          name: o.key.slice("user/".length),
          size: o.size,
          modified: o.uploaded ? o.uploaded.toISOString() : null
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return new Response(JSON.stringify({ files }), {
        headers: { "Content-Type": "application/json", ...cors, ...security, "Cache-Control": "no-store" }
      });
    }

    if (p.startsWith("/api/bucket/")) {
      if (request.method === "OPTIONS") return preflight();
      const raw = p.slice("/api/bucket/".length);
      const json = (o, status) =>
        new Response(JSON.stringify(o), { status: status || 200, headers: { "Content-Type": "application/json", ...cors, ...security, "Cache-Control": "no-store" } });
      if (!raw || raw.includes("/") || raw.includes("..")) return json({ error: "bad name" }, 400);

      if (request.method === "PUT") {
        await env.LUNIX.put("user/" + raw, request.body);
        const head = await env.LUNIX.head("user/" + raw);
        return json({ name: raw, size: head.size });
      }

      if (request.method === "DELETE") {
        await env.LUNIX.delete("user/" + raw);
        return json({ deleted: raw });
      }

      const obj = await env.LUNIX.get("user/" + raw);
      if (!obj) return json({ error: "not found" }, 404);
      const headers = new Headers(obj.writeHttpMetadata || {});
      headers.set("Content-Type", "application/octet-stream");
      headers.set("Content-Disposition", 'attachment; filename="' + raw.replace(/"/g, "") + '"');
      headers.set("Content-Length", obj.size);
      headers.set("Cache-Control", "no-store");
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(obj.body, { headers });
    }

    const mimes = {
      "index.html": "text/html; charset=utf-8",
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
      if (!obj) return new Response("not found", { status: 404 });
      const headers = new Headers(obj.writeHttpMetadata || {});
      headers.set("Content-Type", mimes[key] || "text/plain; charset=utf-8");
      headers.set("Cache-Control", key === "index.html" ? "no-cache" : key.endsWith(".slux") ? "public, max-age=300" : "public, max-age=31536000, immutable");
      headers.set("Content-Length", obj.size);
      return new Response(obj.body, { headers });
    }

    return new Response("not found", { status: 404, headers: security });
  }
};

function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    }
  });
}

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