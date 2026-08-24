/* Lunicraft — a voxel world inside the terminal's tab.
   Zero dependencies. WebGL2. The edge serves bytes; your GPU does the rest.
   Exposes window.Lunicraft = { start(opts), stop() } plus _debug internals for tests. */
(function () {
  "use strict";

  // ------------------------------------------------------------ constants --
  var CS = 16;            // chunk size (x,z)
  var CH = 64;            // chunk height
  var WATER = 21;         // water level
  var REACH = 6;

  var B = { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, WOOD: 4, LEAF: 5, SAND: 6, WATER: 7, PLANK: 8, COBBLE: 9 };
  var SOLID = [false, true, true, true, true, true, true, false, true, true];

  // tile ids in the 4x4 atlas
  var T = { GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, WOOD_SIDE: 4, WOOD_TOP: 5, LEAF: 6, SAND: 7, WATER: 8, PLANK: 9, COBBLE: 10 };
  // block faces: [top, bottom, side]
  var FACETILE = {};
  FACETILE[B.GRASS] = [T.GRASS_TOP, T.DIRT, T.GRASS_SIDE];
  FACETILE[B.DIRT] = [T.DIRT, T.DIRT, T.DIRT];
  FACETILE[B.STONE] = [T.STONE, T.STONE, T.STONE];
  FACETILE[B.WOOD] = [T.WOOD_TOP, T.WOOD_TOP, T.WOOD_SIDE];
  FACETILE[B.LEAF] = [T.LEAF, T.LEAF, T.LEAF];
  FACETILE[B.SAND] = [T.SAND, T.SAND, T.SAND];
  FACETILE[B.WATER] = [T.WATER, T.WATER, T.WATER];
  FACETILE[B.PLANK] = [T.PLANK, T.PLANK, T.PLANK];
  FACETILE[B.COBBLE] = [T.COBBLE, T.COBBLE, T.COBBLE];

  // ------------------------------------------------------------- rng/noise --
  // pure so tests can pin it: forward/right/up must stay orthonormal, up never flips
  function viewBasis(yaw, pitch) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var f = [sy * cp, sp, -cy * cp];                 // forward
    var r = [-f[2], 0, f[0]];                        // right = (-Fz, 0, Fx) — +x when facing -z
    var rl = Math.sqrt(r[0] * r[0] + r[2] * r[2]) || 1;
    r[0] /= rl; r[2] /= rl;
    var u = [                                        // up = cross(right, forward)
      r[1] * f[2] - r[2] * f[1],
      r[2] * f[0] - r[0] * f[2],
      r[0] * f[1] - r[1] * f[0]
    ];
    return { f: f, r: r, u: u };
  }
  function hash2(seed, x, y) {
    var h = seed >>> 0;
    h = (Math.imul(h ^ x, 0x27d4eb2d) ^ Math.imul(y + 0x9e3779b9, 0x165667b1)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function vnoise(seed, x, z) {
    var ix = Math.floor(x), iz = Math.floor(z), fx = smooth(x - ix), fz = smooth(z - iz);
    var a = hash2(seed, ix, iz), b = hash2(seed, ix + 1, iz), c = hash2(seed, ix, iz + 1), d = hash2(seed, ix + 1, iz + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }
  function fbm(seed, x, z) {
    var v = 0, amp = 0.5, f = 1;
    for (var o = 0; o < 4; o++) { v += vnoise(seed + o * 1013, x * f, z * f) * amp; amp *= 0.5; f *= 2; }
    return v / 0.9375;
  }

  // ---------------------------------------------------------------- blocks --
  function columnHeight(seed, wx, wz) {
    var cont = fbm(seed, wx * 0.008, wz * 0.008);          // continents
    var hills = fbm(seed + 777, wx * 0.03, wz * 0.03);     // hills
    var rough = fbm(seed + 1337, wx * 0.11, wz * 0.11);    // detail
    return Math.floor(14 + cont * 26 + hills * 12 + rough * 4);
  }
  function genColumn(seed, wx, wz) {
    var h = columnHeight(seed, wx, wz);
    var out = [];
    for (var y = 0; y < CH; y++) {
      var b = B.AIR;
      if (y === 0) b = B.STONE;
      else if (y < h - 3) b = B.STONE;
      else if (y < h) b = (h <= WATER + 1) ? B.SAND : B.DIRT;
      else if (y === h) b = (h <= WATER + 1) ? B.SAND : (h < WATER + 3 ? B.SAND : B.GRASS);
      else if (y <= WATER) b = B.WATER;
      out.push(b);
    }
    return { h: Math.min(h, CH - 1), col: out };
  }
  function genChunk(seed, cx, cz) {
    var blocks = new Uint8Array(CS * CS * CH);
    var heights = new Int16Array(CS * CS);
    for (var z = 0; z < CS; z++)
      for (var x = 0; x < CS; x++) {
        var g = genColumn(seed, cx * CS + x, cz * CS + z);
        heights[z * CS + x] = g.h;
        for (var y = 0; y < CH; y++) blocks[(y * CS + z) * CS + x] = g.col[y];
      }
    // trees — kept 2 blocks off the edges so they never cross chunk borders
    for (var z2 = 2; z2 < CS - 2; z2++)
      for (var x2 = 2; x2 < CS - 2; x2++) {
        var wx2 = cx * CS + x2, wz2 = cz * CS + z2;
        var h2 = heights[z2 * CS + x2];
        if (h2 > WATER + 1 && h2 < CH - 9 && hash2(seed + 555, wx2, wz2) < 0.012) plantTree(blocks, x2, h2 + 1, z2, seed, wx2, wz2);
      }
    return blocks;
  }
  function plantTree(blocks, x, y, z, seed, wx, wz) {
    var th = 4 + Math.floor(hash2(seed + 999, wx, wz) * 2); // 4-5
    for (var i = 0; i < th && y + i < CH; i++) blocks[((y + i) * CS + z) * CS + x] = B.WOOD;
    var top = y + th;
    for (var dy = -2; dy <= 1; dy++)
      for (var dz = -2; dz <= 2; dz++)
        for (var dx = -2; dx <= 2; dx++) {
          if (dy >= 0 && (Math.abs(dx) > 1 || Math.abs(dz) > 1)) continue;
          if (dx === 0 && dz === 0 && dy < 0) continue;
          var yy = top + dy, xx = x + dx, zz = z + dz;
          if (yy < 0 || yy >= CH || xx < 0 || xx >= CS || zz < 0 || zz >= CS) continue;
          var idx = (yy * CS + zz) * CS + xx;
          if (blocks[idx] === B.AIR) blocks[idx] = B.LEAF;
        }
  }

  // -------------------------------------------------------------- meshing --
  // faces: +x,-x,+y,-y,+z,-z — corner tables per face (two triangles via idx pattern 0,1,2 0,2,3)
  var FACE = [
    { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], l: 0.76 },
    { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], l: 0.76 },
    { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], l: 1.0 },
    { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], l: 0.45 },
    { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], l: 0.62 },
    { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], l: 0.62 }
  ];
  function opaque(id) { return id !== B.AIR && id !== B.WATER && id !== B.LEAF; }
  function meshChunk(seed, cx, cz, blocks, getNeighbor) {
    // getNeighbor(dir): blocks of adjacent chunk or null (treat missing as air walls? draw them)
    function nb(x, y, z) { // neighbor block in local coords, may cross into adjacent chunks
      if (y < 0) return B.STONE; // below the world is solid — no wasted bottom-of-world faces
      if (y >= CH) return B.AIR;
      if (x >= 0 && x < CS && z >= 0 && z < CS) return blocks[(y * CS + z) * CS + x];
      var ncx = cx, ncz = cz, lx = x, lz = z;
      if (x < 0) { ncx--; lx += CS; } else if (x >= CS) { ncx++; lx -= CS; }
      if (z < 0) { ncz--; lz += CS; } else if (z >= CS) { ncz++; lz -= CS; }
      var nbk = getNeighbor ? getNeighbor(ncx, ncz) : null;
      if (!nbk) return B.AIR;
      return nbk[(y * CS + lz) * CS + lx];
    }
    var verts = [], idx = [], vi = 0;
    for (var y = 0; y < CH; y++)
      for (var z = 0; z < CS; z++)
        for (var x = 0; x < CS; x++) {
          var id = blocks[(y * CS + z) * CS + x];
          if (id === B.AIR) continue;
          var isWater = id === B.WATER;
          for (var f = 0; f < 6; f++) {
            var F = FACE[f];
            var nid = nb(x + F.n[0], y + F.n[1], z + F.n[2]);
            if (opaque(nid)) continue;
            if (isWater && nid === B.WATER) continue;
            if (!isWater && id !== B.LEAF && nid === id) continue; // glassless cull between same solids (leaves stay fluffy)
            var tiles = FACETILE[id];
            var tile = f === 2 ? tiles[0] : f === 3 ? tiles[1] : tiles[2];
            var tu = (tile % 4) / 4, tv = Math.floor(tile / 4) / 4;
            var light = F.l * (isWater ? 0.9 : 1.0);
            for (var ci = 0; ci < 4; ci++) {
              var cnr = F.c[ci];
              var vy = y + cnr[1];
              if (isWater && cnr[1] === 1 && nb(x, y + 1, z) !== B.WATER) vy -= 0.12; // sunken water surface
              var uu = tu + ((ci === 1 || ci === 2) ? 0.25 : 0);
              var vv = tv + (cnr[1] ? 0 : 0.25); // canvas rows run top-down: block tops meet the tile's top edge
              verts.push(cx * CS + x + cnr[0], vy, cz * CS + z + cnr[2], uu, vv, light);
            }
            // flip quad diagonal for even interpolation (avoids anisotropy artifacts)
            if ((x + y + z) % 2 === 0) idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
            else idx.push(vi + 1, vi + 2, vi + 3, vi + 1, vi + 3, vi);
            vi += 4;
          }
        }
    return { verts: verts, idx: idx };
  }

  // -------------------------------------------------------------- raycast --
  function raycast(getBlock, ox, oy, oz, dx, dy, dz, maxDist) {
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!len) return null;
    dx /= len; dy /= len; dz /= len;
    var x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    var stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    var tMaxX = dx !== 0 ? ((dx > 0 ? x + 1 - ox : ox - x) / Math.abs(dx)) : Infinity;
    var tMaxY = dy !== 0 ? ((dy > 0 ? y + 1 - oy : oy - y) / Math.abs(dy)) : Infinity;
    var tMaxZ = dz !== 0 ? ((dz > 0 ? z + 1 - oz : oz - z) / Math.abs(dz)) : Infinity;
    var tDeltaX = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
    var tDeltaY = dy !== 0 ? 1 / Math.abs(dy) : Infinity;
    var tDeltaZ = dz !== 0 ? 1 / Math.abs(dz) : Infinity;
    var px = x, py = y, pz = z, t = 0;
    while (t <= maxDist) {
      var id = getBlock(x, y, z);
      if (id !== B.AIR && id !== B.WATER) return { x: x, y: y, z: z, px: px, py: py, pz: pz, id: id };
      px = x; py = y; pz = z;
      if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; }
      else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; }
      else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; }
    }
    return null;
  }

  // ------------------------------------------------------------- physics --
  function collides(getBlock, x, y, z) { // AABB feet-box: half-width .3, height 1.8
    var r = 0.3;
    for (var bx = Math.floor(x - r); bx <= Math.floor(x + r); bx++)
      for (var by = Math.floor(y); by <= Math.floor(y + 1.79); by++)
        for (var bz = Math.floor(z - r); bz <= Math.floor(z + r); bz++)
          if (SOLID[getBlock(bx, by, bz)]) return true;
    return false;
  }
  function moveBody(getBlock, pos, vel, dt) {
    // sub-step so nothing moves more than 0.25 blocks per iteration (no tunneling)
    var maxV = Math.max(Math.abs(vel.x), Math.abs(vel.y), Math.abs(vel.z));
    var n = Math.max(1, Math.ceil((maxV * dt) / 0.25));
    var sdt = dt / n;
    var order = ["x", "y", "z"], grounded = false;
    for (var si = 0; si < n; si++) {
      for (var oi = 0; oi < 3; oi++) {
        var ax = order[oi];
        var np = pos[ax] + vel[ax] * sdt;
        var probe = { x: pos.x, y: pos.y, z: pos.z };
        probe[ax] = np;
        if (!collides(getBlock, probe.x, probe.y, probe.z)) {
          pos[ax] = np;
        } else if (ax === "y") {
          if (vel.y < 0) { pos.y = Math.floor(np) + 1; grounded = true; } // land flush on the block top
          vel.y = 0;
        } else vel[ax] = 0;
      }
      if (grounded && vel.y === 0) break;
    }
    return grounded;
  }

  // ------------------------------------------------------------- textures --
  function paintAtlas() {
    if (typeof document === "undefined") return null; // headless (tests) — GL path never runs there
    var cv = document.createElement("canvas");
    cv.width = 64; cv.height = 64;
    var g = cv.getContext("2d");
    function px(t, fn) {
      var tx = (t % 4) * 16, ty = Math.floor(t / 4) * 16;
      for (var y = 0; y < 16; y++)
        for (var x = 0; x < 16; x++) {
          var c = fn(x, y, hash2(t * 7919 + y * 31 + x, x, y));
          g.fillStyle = c; g.fillRect(tx + x, ty + y, 1, 1);
        }
    }
    function rgb(r, gg, b2) { return "rgb(" + r + "," + gg + "," + b2 + ")"; }
    px(T.GRASS_TOP, function (x, y, n) { return rgb(70 + n * 40, 124 + n * 50, 46 + n * 30); });
    px(T.GRASS_SIDE, function (x, y, n) {
      if (y < 3) return rgb(70 + n * 40, 124 + n * 50, 46 + n * 30);
      return rgb(112 + n * 30, 78 + n * 24, 48 + n * 18);
    });
    px(T.DIRT, function (x, y, n) { return rgb(112 + n * 34, 78 + n * 26, 48 + n * 20); });
    px(T.STONE, function (x, y, n) { var v = 118 + n * 30; return rgb(v, v, v + 4); });
    px(T.COBBLE, function (x, y, n) { var v = 100 + n * 44 + ((x * y + x) % 5) * 6; return rgb(v, v, v + 4); });
    px(T.SAND, function (x, y, n) { return rgb(214 + n * 24, 196 + n * 26, 142 + n * 30); });
    px(T.WOOD_SIDE, function (x, y, n) { var s = (x % 4 === 0) ? 26 : n * 16; return rgb(96 + s, 68 + s * 0.7, 38 + s * 0.5); });
    px(T.WOOD_TOP, function (x, y, n) { var r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); return rgb(120 + n * 18 - r * 4, 86 + n * 14 - r * 3, 48 + n * 10 - r * 2); });
    px(T.LEAF, function (x, y, n) { return rgb(34 + n * 44, 92 + n * 56, 28 + n * 36); });
    px(T.WATER, function (x, y, n) { return rgb(38 + n * 18, 84 + n * 26, 168 + n * 40); });
    px(T.PLANK, function (x, y, n) { var s = (y % 8 === 0) ? 24 : n * 14; return rgb(158 + s, 122 + s * 0.8, 74 + s * 0.6); });
    return cv;
  }

  // ---------------------------------------------------------------- state --
  var S = null; // live session

  function start(opts) {
    if (S) stop();
    opts = opts || {};
    var mount = opts.mount || document.body;
    var seed = opts.seed >>> 0 || 1;
    var edits = opts.edits || {};   // {"x,y,z": blockId}

    // ---- dom ----
    var wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;inset:0;z-index:9998;background:#000;font-family:'Ubuntu Mono',monospace";
    var bar = document.createElement("div");
    bar.style.cssText = "position:absolute;top:0;left:0;right:0;height:28px;background:#0a0a0a;border-bottom:1px solid #222;display:flex;align-items:center;padding:0 10px;color:#c9c9c9;z-index:3";
    bar.innerHTML = "<span style='color:#4e9a06'>lunecraft</span><span style='color:#666'> — seed " + seed + "</span><span style='flex:1'></span><span id='lc-fps' style='color:#888;margin-right:12px'></span><button id='lc-x' style='background:none;border:1px solid #333;color:#c9c9c9;cursor:pointer;padding:2px 8px'>✕ quit</button>";
    var cv = document.createElement("canvas");
    cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;outline:none";
    var hud = document.createElement("div");
    hud.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;color:#fff;text-shadow:0 0 2px #000;font-size:18px";
    hud.textContent = "+";
    var pause = document.createElement("div");
    pause.style.cssText = "position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);color:#c9c9c9;z-index:2;flex-direction:column;text-align:center";
    pause.innerHTML = "<div style='font-size:22px;margin-bottom:8px'><span style='color:#4e9a06'>lunecraft</span> paused</div><div style='color:#888'>click to grab the mouse · wasd move · space jump<br>left click mine · right click place · esc pause</div>";
    wrap.appendChild(cv); wrap.appendChild(hud); wrap.appendChild(bar); wrap.appendChild(pause);
    mount.appendChild(wrap);

    // ---- gl ----
    var gl = cv.getContext("webgl2", { antialias: false });
    if (!gl) throw new Error("WebGL2 unavailable");

    var VS = "#version 300 es\nprecision highp float;" +
      "layout(location=0) in vec3 aPos;layout(location=1) in vec2 aUV;layout(location=2) in float aL;" +
      "uniform mat4 uPV;out vec2 vUV;out float vL;" +
      "void main(){vUV=aUV;vL=aL;gl_Position=uPV*vec4(aPos,1.0);}";
    var FS = "#version 300 es\nprecision highp float;" +
      "in vec2 vUV;in float vL;uniform sampler2D uT;out vec4 o;" +
      "void main(){vec4 c=texture(uT,vUV);if(c.a<0.5)discard;o=vec4(c.rgb*vL,1.0);}";
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    var uPV = gl.getUniformLocation(prog, "uPV");

    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paintAtlas());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    // ---- world ----
    var chunks = {};       // "cx,cz" -> {blocks, vao, vbo, ibo, count, dirty}
    var pending = [];
    function ck(x, z) { return x + "," + z; }
    function chunkBlocks(cx, cz) {
      var k = ck(cx, cz), c = chunks[k];
      if (c) return c.blocks;
      var bl = genChunk(seed, cx, cz);
      // apply persisted edits for this chunk
      var x0 = cx * CS, z0 = cz * CS;
      for (var e in edits) {
        var p = e.split(",");
        var ex = +p[0], ey = +p[1], ez = +p[2];
        if (ex >= x0 && ex < x0 + CS && ez >= z0 && ez < z0 + CS && ey >= 0 && ey < CH)
          bl[((ey) * CS + (ez - z0)) * CS + (ex - x0)] = edits[e];
      }
      c = chunks[k] = { blocks: bl, vao: null, count: 0, dirty: true };
      return bl;
    }
    function gb(wx, wy, wz) {
      if (wy < 0) return B.STONE;
      if (wy >= CH) return B.AIR;
      var cx = Math.floor(wx / CS), cz = Math.floor(wz / CS);
      var bl = chunkBlocks(cx, cz);
      return bl[((wy) * CS + (wz - cz * CS)) * CS + (wx - cx * CS)];
    }
    function sb(wx, wy, wz, id) {
      if (wy < 1 || wy >= CH) return;
      var cx = Math.floor(wx / CS), cz = Math.floor(wz / CS);
      var bl = chunkBlocks(cx, cz);
      bl[((wy) * CS + (wz - cz * CS)) * CS + (wx - cx * CS)] = id;
      edits[wx + "," + wy + "," + wz] = id;
      markDirty(cx, cz);
      var lx = wx - cx * CS, lz = wz - cz * CS;
      if (lx === 0) markDirty(cx - 1, cz);
      if (lx === CS - 1) markDirty(cx + 1, cz);
      if (lz === 0) markDirty(cx, cz - 1);
      if (lz === CS - 1) markDirty(cx, cz + 1);
    }
    function markDirty(cx, cz) {
      var c = chunks[ck(cx, cz)];
      if (c) c.dirty = true;
    }

    // ---- meshing to gpu ----
    function upload(c, cx, cz) {
      var m = meshChunk(seed, cx, cz, c.blocks, function (nx, nz) {
        var n = chunks[ck(nx, nz)];
        return n ? n.blocks : null;
      });
      if (!c.vao) {
        c.vao = gl.createVertexArray();
        c.vbo = gl.createBuffer();
        c.ibo = gl.createBuffer();
      }
      gl.bindVertexArray(c.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, c.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(m.verts), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(m.idx), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
      gl.bindVertexArray(null);
      c.count = m.idx.length;
      c.dirty = false;
    }

    // ---- player ----
    var spawnH = columnHeight(seed, 8, 8);
    var P = { x: 8.5, y: Math.max(spawnH + 2, WATER + 2), z: 8.5, yaw: 0.6, pitch: -0.15, vx: 0, vy: 0, vz: 0, fly: false, onGround: false };
    var keys = {};
    var RADIUS = 9; // chunk view radius

    function look(dx, dy) {
      P.yaw += dx * 0.0028;
      P.pitch -= dy * 0.0028;
      if (P.pitch > 1.55) P.pitch = 1.55;
      if (P.pitch < -1.55) P.pitch = -1.55;
    }

    function stepPlayer(dt) {
      var sp = keys["ShiftLeft"] ? 9.5 : 5.2;
      var b = viewBasis(P.yaw, 0); // controls share the camera's basis — W always goes where you look
      var fx = b.f[0], fz = b.f[2], rxv = b.r[0], rzv = b.r[2];
      var mx = 0, mz = 0;
      if (keys["KeyW"]) { mx += fx; mz += fz; }
      if (keys["KeyS"]) { mx -= fx; mz -= fz; }
      if (keys["KeyA"]) { mx -= rxv; mz -= rzv; }
      if (keys["KeyD"]) { mx += rxv; mz += rzv; }
      var ml = Math.sqrt(mx * mx + mz * mz);
      if (ml > 0) { mx /= ml; mz /= ml; }
      var inWater = gb(Math.floor(P.x), Math.floor(P.y + 0.4), Math.floor(P.z)) === B.WATER;
      if (P.fly) {
        P.vx = mx * sp * 2; P.vz = mz * sp * 2;
        P.vy = (keys["Space"] ? 8 : 0) - (keys["ControlLeft"] ? 8 : 0);
      } else {
        var acc = P.onGround ? 42 : 14;
        P.vx += (mx * sp - P.vx) * Math.min(1, acc * dt / sp);
        P.vz += (mz * sp - P.vz) * Math.min(1, acc * dt / sp);
        if (inWater) { P.vy += -4 * dt; P.vy = Math.max(P.vy, -3); if (keys["Space"]) P.vy = 3.4; }
        else { P.vy -= 24 * dt; if (keys["Space"] && P.onGround) { P.vy = 8.2; P.onGround = false; } }
      }
      var body = { x: P.x, y: P.y, z: P.z }, vel = { x: P.vx, y: P.vy, z: P.vz };
      P.onGround = moveBody(function (bx, by, bz) { return gb(bx, by, bz); }, body, vel, dt);
      P.x = body.x; P.y = body.y; P.z = body.z; P.vx = vel.x; P.vy = vel.y; P.vz = vel.z;
      if (P.y < -10) { P.y = CH + 2; P.vy = 0; } // fell out somehow — respawn up top
    }

    // ---- camera ----
    function matPersp(fov, asp, n, f) {
      var t = 1 / Math.tan(fov / 2);
      return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0];
    }
    function matView() {
      var b = viewBasis(P.yaw, P.pitch);
      var ex = P.x, ey = P.y + 1.62, ez = P.z;
      return [b.r[0], b.u[0], -b.f[0], 0, b.r[1], b.u[1], -b.f[1], 0, b.r[2], b.u[2], -b.f[2], 0,
        -(b.r[0] * ex + b.r[1] * ey + b.r[2] * ez), -(b.u[0] * ex + b.u[1] * ey + b.u[2] * ez), (b.f[0] * ex + b.f[1] * ey + b.f[2] * ez), 1];
    }
    function matMul(a, b) {
      var o = new Array(16);
      for (var ccc = 0; ccc < 4; ccc++)
        for (var rr = 0; rr < 4; rr++) {
          var v = 0;
          for (var kk = 0; kk < 4; kk++) v += a[kk * 4 + rr] * b[ccc * 4 + kk];
          o[ccc * 4 + rr] = v;
        }
      return o;
    }

    // ---- interaction ----
    function targetBlock() {
      var cp = Math.cos(P.pitch), spp = Math.sin(P.pitch), cy = Math.cos(P.yaw), sy = Math.sin(P.yaw);
      return raycast(gb, P.x, P.y + 1.62, P.z, sy * cp, spp, -cy * cp, REACH);
    }
    function onMouseDown(e) {
      if (document.pointerLockElement !== cv) { lockReq(); return; }
      var hit = targetBlock();
      if (!hit) return;
      if (e.button === 0) sb(hit.x, hit.y, hit.z, B.AIR);
      else if (e.button === 2) {
        // don't place inside yourself
        var r = 0.3;
        var px = hit.px, py = hit.py, pz = hit.pz;
        var overlap = px + 1 > P.x - r && px < P.x + r && pz + 1 > P.z - r && pz < P.z + r && py + 1 > P.y && py < P.y + 1.8;
        if (!overlap && !SOLID[gb(px, py, pz)] || gb(px, py, pz) === B.WATER) sb(px, py, pz, hotbar());
      } else if (e.button === 1) {
        // middle click pick
      }
    }
    var BLOCK_CYCLE = [B.COBBLE, B.PLANK, B.WOOD, B.STONE, B.SAND, B.DIRT, B.GRASS];
    var hbIdx = 0;
    function hotbar() { return BLOCK_CYCLE[hbIdx % BLOCK_CYCLE.length]; }
    function onWheel(e) {
      if (document.pointerLockElement !== cv) return;
      e.preventDefault();
      hbIdx = (hbIdx + (e.deltaY > 0 ? 1 : BLOCK_CYCLE.length - 1)) % BLOCK_CYCLE.length;
      hud.textContent = "+ [" + ["cobble", "plank", "wood", "stone", "sand", "dirt", "grass"][hbIdx] + "]";
    }

    // ---- input plumbing ----
    function onKeyDown(e) {
      if (e.code === "Escape") return; // browser exits pointer lock itself
      keys[e.code] = true;
      if (e.code === "KeyF") P.fly = !P.fly;
      if (e.code === "Space" || e.code === "Tab") e.preventDefault();
    }
    function onKeyUp(e) { keys[e.code] = false; }
    function onMouseMove(e) {
      if (document.pointerLockElement === cv) look(e.movementX || 0, e.movementY || 0);
    }
    function onLockChange() {
      var locked = document.pointerLockElement === cv;
      pause.style.display = locked ? "none" : "flex";
    }
    function lockReq() { cv.requestPointerLock(); }
    function onResize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = cv.clientWidth * dpr;
      cv.height = cv.clientHeight * dpr;
      gl.viewport(0, 0, cv.width, cv.height);
    }

    cv.addEventListener("mousedown", onMouseDown);
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("pointerlockchange", onLockChange);
    window.addEventListener("resize", onResize);
    bar.querySelector("#lc-x").addEventListener("click", function () { stop(true); });

    // ---- chunk streaming ----
    function streamChunks() {
      var pcx = Math.floor(P.x / CS), pcz = Math.floor(P.z / CS);
      var want = [];
      for (var dz = -RADIUS; dz <= RADIUS; dz++)
        for (var dx = -RADIUS; dx <= RADIUS; dx++) {
          if (dx * dx + dz * dz > (RADIUS + 0.5) * (RADIUS + 0.5)) continue;
          var cx = pcx + dx, cz = pcz + dz, k = ck(cx, cz);
          if (!chunks[k]) want.push([cx, cz, dx * dx + dz * dz]);
        }
      want.sort(function (a, b) { return a[2] - b[2]; });
      var budget = 2;
      for (var i = 0; i < want.length && budget > 0; i++) { chunkBlocks(want[i][0], want[i][1]); budget--; }
      // unload far chunks
      for (var k2 in chunks) {
        var pp = k2.split(",");
        var ddx = +pp[0] - pcx, ddz = +pp[1] - pcz;
        if (ddx * ddx + ddz * ddz > (RADIUS + 3) * (RADIUS + 3)) {
          var cc = chunks[k2];
          if (cc.vao) { gl.deleteVertexArray(cc.vao); gl.deleteBuffer(cc.vbo); gl.deleteBuffer(cc.ibo); }
          delete chunks[k2];
        }
      }
    }

    // ---- frame ----
    var frames = 0, fpsT = performance.now(), last = performance.now(), raf = 0, stopped = false;
    function frame(now) {
      if (stopped) return;
      raf = requestAnimationFrame(frame);
      var dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (document.pointerLockElement === cv) stepPlayer(dt);
      streamChunks();

      // upload dirty chunks (budget per frame)
      var uploads = 3;
      for (var k in chunks) {
        var c = chunks[k];
        if (c.dirty) { var pq = k.split(","); upload(c, +pq[0], +pq[1]); if (--uploads <= 0) break; }
      }

      gl.clearColor(0.53, 0.81, 0.98, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      var pv = matMul(matPersp(1.25, cv.width / Math.max(1, cv.height), 0.1, 400), matView());
      gl.uniformMatrix4fv(uPV, false, new Float32Array(pv));
      for (var k3 in chunks) {
        var cc3 = chunks[k3];
        if (!cc3.count) continue;
        gl.bindVertexArray(cc3.vao);
        gl.drawElements(gl.TRIANGLES, cc3.count, gl.UNSIGNED_INT, 0);
      }
      gl.bindVertexArray(null);

      frames++;
      if (now - fpsT > 500) {
        var el = bar.querySelector("#lc-fps");
        if (el) el.textContent = Math.round(frames * 1000 / (now - fpsT)) + " fps · " + Object.keys(chunks).length + " chunks";
        frames = 0; fpsT = now;
      }
    }

    onResize();
    streamChunks();
    raf = requestAnimationFrame(frame);
    setTimeout(lockReq, 50);

    S = {
      wrap: wrap,
      stop: function (save) {
        stopped = true;
        cancelAnimationFrame(raf);
        document.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("keyup", onKeyUp, true);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("pointerlockchange", onLockChange);
        window.removeEventListener("resize", onResize);
        if (document.pointerLockElement === cv) document.exitPointerLock();
        var out = null;
        if (save !== false) out = { seed: seed, edits: edits, player: { x: P.x, y: P.y, z: P.z, yaw: P.yaw, pitch: P.pitch } };
        wrap.remove();
        S = null;
        if (out && typeof opts.onExit === "function") { try { opts.onExit(out); } catch (eCb) {} }
        return out;
      }
    };
    return S;
  }

  function stop(save) { return S ? S.stop(save) : null; }

  window.Lunicraft = {
    start: start,
    stop: stop,
    _debug: {
      B: B, SOLID: SOLID, CS: CS, CH: CH, WATER: WATER,
      hash2: hash2, vnoise: vnoise, fbm: fbm,
      columnHeight: columnHeight, genChunk: genChunk,
      meshChunk: meshChunk, raycast: raycast, collides: collides, moveBody: moveBody,
      paintAtlas: paintAtlas, viewBasis: viewBasis
    }
  };
})();
