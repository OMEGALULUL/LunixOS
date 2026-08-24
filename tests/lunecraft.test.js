// Lunicraft engine logic tests — pure math paths, no WebGL required.
const fs = require("fs"), path = require("path");
global.window = {};
require(path.join(__dirname, "..", "assets", "lunecraft.js"));
const D = window.Lunicraft._debug;
let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? pass++ : fail++; console.log((c ? "  ok - " : "  FAIL - ") + n + (c && !extra ? "" : " " + (extra || ""))); };

console.log("world generation:");
ok("column height is deterministic", D.columnHeight(42, 500, -500) === D.columnHeight(42, 500, -500));
const hA = D.columnHeight(1, 10, 10), hB = D.columnHeight(999, 10, 10);
ok("seeds produce different worlds (sampled)", (() => {
  let diff = false;
  for (let i = 0; i < 50 && !diff; i++) if (D.columnHeight(1, i * 7, i * 3) !== D.columnHeight(999, i * 7, i * 3)) diff = true;
  return diff;
})());
(function terrainShape() {
  let minH = 99, maxH = -1, aboveWater = 0;
  for (let x = 0; x < 64; x += 4) for (let z = 0; z < 64; z += 4) {
    const h = D.columnHeight(7, x, z);
    if (h < minH) minH = h; if (h > maxH) maxH = h; if (h > D.WATER) aboveWater++;
  }
  ok("terrain has relief and dry land", maxH - minH >= 8 && aboveWater > 0, `min ${minH} max ${maxH} dry ${aboveWater}/256`);
})();
(function chunkStructure() {
  const bl = D.genChunk(5, 0, 0);
  ok("chunk is solid array of right size", bl instanceof Uint8Array && bl.length === 16 * 16 * 64);
  ok("bedrock floor everywhere", (() => { for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if (bl[(0 * 16 + z) * 16 + x] !== D.B.STONE) return false; return true; })());
  ok("some air exists above ground", bl.includes(D.B.AIR));
})();

console.log("meshing:");
(function meshCull() {
  function flat(get) { const b = new Uint8Array(16 * 16 * 64); get(b); return D.meshChunk(1, 0, 0, b); }
  const one = flat((b) => { b[((5 * 16 + 8) * 16) + 8] = D.B.STONE; });
  ok("single block emits exactly 6 faces (24 verts)", one.idx.length === 36, one.idx.length / 6 + " faces");
  const two = flat((b) => {
    b[((5 * 16 + 8) * 16) + 8] = D.B.STONE;
    b[((5 * 16 + 8) * 16) + 9] = D.B.STONE;
  });
  ok("two adjacent blocks cull the shared face", two.idx.length === 60, two.idx.length / 6 + " faces");
  const cube = flat((b) => {
    for (let y = 4; y <= 6; y++) for (let z = 7; z <= 9; z++) for (let x = 7; x <= 9; x++) b[((y * 16 + z) * 16) + x] = D.B.STONE;
  });
  ok("3x3x3 cube shows exactly its 54 exterior faces (interior culled)", cube.idx.length / 6 === 54, cube.idx.length / 6 + " faces");
  const slab = flat((b) => {
    for (let y = 0; y < 3; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) b[((y * 16 + z) * 16) + x] = D.B.STONE;
  });
  // interior culs; only the top face of the surface layer + border walls (unloaded neighbors) remain
  const expected = 256 /* top */ + 3 * 64 /* chunk-border walls, unloaded neighbors draw */;
  ok("slab culls interior; top + border walls only", slab.idx.length / 6 === expected, slab.idx.length / 6 + " faces (want " + expected + ")");
})();

console.log("raycast:");
(function ray() {
  const world = (x, y, z) => (x === 4 && y === 5 && z === 3) ? D.B.STONE : D.B.AIR;
  const hit = D.raycast(world, 0.5, 5.5, 3.2, 1, 0, 0, 20);
  ok("ray hits the expected voxel", !!hit && hit.x === 4 && hit.y === 5 && hit.z === 3);
  ok("ray reports the face you'd place against", hit.px === 3 && hit.py === 5 && hit.pz === 3);
  ok("miss returns null", D.raycast(world, 0.5, 5.5, 3.9, 0, 1, 0, 20) === null);
})();

console.log("physics:");
(function phys() {
  const floor = (x, y, z) => (y === 0) ? D.B.STONE : D.B.AIR;
  const pos = { x: 8.5, y: 5, z: 8.5 }, vel = { x: 0, y: 0, z: 0 };
  let grounded = false;
  for (let i = 0; i < 400 && !grounded; i++) { vel.y -= 24 * 0.016; grounded = D.moveBody(floor, pos, vel, 0.016); }
  ok("gravity lands you flush on the floor", grounded && Math.abs(pos.y - 1) < 0.001, "rest y=" + pos.y.toFixed(4));
  const wall = (x, y, z) => (z === 9 && y >= 1 && y <= 2) ? D.B.COBBLE : ((y === 0) ? D.B.STONE : D.B.AIR);
  const p2 = { x: 8.5, y: 1.01, z: 8.5 }, v2 = { x: 0, y: 0, z: 3 };
  for (let i = 0; i < 120; i++) { v2.z = 3; D.moveBody(wall, p2, v2, 0.016); }
  ok("walls stop horizontal movement", p2.z < 9.01, "stopped at z=" + p2.z.toFixed(3));
})();

console.log("textures:");
(function tex() {
  const cv = D.paintAtlas();
  ok("atlas is browser-canvas painted (null in headless, GL never runs here)", cv === null || (cv.width === 64 && cv.height === 64));
})();

console.log("camera basis (the upside-down incident):");
(function cam() {
  const VB = D.viewBasis, eps = 1e-9;
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  let b0 = VB(0, 0);
  ok("yaw 0 pitch 0 faces -z", near(b0.f[0], 0) && near(b0.f[1], 0) && near(b0.f[2], -1), JSON.stringify(b0.f));
  ok("yaw 0 right is +x (was negated before)", near(b0.r[0], 1) && near(b0.r[2], 0), JSON.stringify(b0.r));
  ok("yaw 0 up is +y (terrain used to hang from the sky)", near(b0.u[1], 1) && b0.u[1] > 0, JSON.stringify(b0.u));
  let sound = true, detail = "";
  for (let yaw = -3.2; yaw <= 3.2; yaw += 0.37) for (let pitch = -1.55; pitch <= 1.55; pitch += 0.31) {
    const b = VB(yaw, pitch);
    const dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
    const len = (a) => Math.sqrt(dot(a, a));
    if (!(near(len(b.f), 1) && near(len(b.r), 1) && near(len(b.u), 1))) { sound = false; detail = "not unit at " + yaw.toFixed(2) + "/" + pitch.toFixed(2); }
    if (!(near(dot(b.f, b.r), 0) && near(dot(b.f, b.u), 0) && near(dot(b.r, b.u), 0))) { sound = false; detail = "not orthogonal at " + yaw.toFixed(2) + "/" + pitch.toFixed(2); }
    if (b.u[1] <= 0) { sound = false; detail = "up flipped at " + yaw.toFixed(2) + "/" + pitch.toFixed(2); }
  }
  ok("basis orthonormal and up-positive over full look range", sound, detail);
})();

console.log("keyboard steering (touchpad-hostile laptops):");
(function steer() {
  const LK = D.lookKeys, K = (codes) => { const o = {}; codes.forEach((c) => (o[c] = true)); return o; };
  ok("left arrow turns left (yaw decreases)", LK(K(["ArrowLeft"]), 1, 0, 0.5).yaw < 1);
  ok("right arrow turns right (yaw increases)", LK(K(["ArrowRight"]), 1, 0, 0.5).yaw > 1);
  ok("E turns right too", LK(K(["KeyE"]), 1, 0, 0.5).yaw > 1);
  ok("up arrow looks up (pitch increases)", LK(K(["ArrowUp"]), 0, 0, 0.5).pitch > 0);
  ok("down arrow looks down", LK(K(["ArrowDown"]), 0, 0, 0.5).pitch < 0);
  const clamped = LK(K(["ArrowUp"]), 0, 1.54, 10); // huge dt would blow past the clamp
  ok("pitch clamps at +/-1.55 even with big steps", clamped.pitch <= 1.55 && LK(K(["ArrowDown"]), 0, -9, 10).pitch >= -1.55);
})();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
