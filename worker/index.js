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

    if (p === "/wisp") {
      return handleWisp(request);
    }

    if (p === "/api/bucket") {
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
        headers: { "Content-Type": "application/json", ...security, "Cache-Control": "no-store" }
      });
    }

    if (p.startsWith("/api/bucket/")) {
      const raw = p.slice("/api/bucket/".length);
      if (!raw || raw.includes("/") || raw.includes("..")) {
        return new Response(JSON.stringify({ error: "bad name" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      const obj = await env.LUNIX.get("user/" + raw);
      if (!obj) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
      const headers = new Headers(obj.writeHttpMetadata || {});
      headers.set("Content-Type", "application/octet-stream");
      headers.set("Content-Disposition", 'attachment; filename="' + raw.replace(/"/g, "") + '"');
      headers.set("Content-Length", obj.size);
      headers.set("Cache-Control", "no-store");
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
    if (mimes[key]) {
      const obj = await env.LUNIX.get(key);
      if (!obj) return new Response("not found", { status: 404 });
      const headers = new Headers(obj.writeHttpMetadata || {});
      headers.set("Content-Type", mimes[key]);
      headers.set("Cache-Control", key === "index.html" ? "no-cache" : "public, max-age=31536000, immutable");
      headers.set("Content-Length", obj.size);
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