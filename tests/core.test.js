const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const WASM_PATH = path.join(__dirname, "..", "assets", "lunix_core.wasm");
let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? pass++ : fail++; console.log((c ? "  ok - " : "  FAIL - ") + n + (c ? "" : " " + extra)); };

function fnv1a64ref(buf) {
  let h = 0xcbf29ce484222325n, prime = 0x100000001b3n;
  for (const b of buf) { h ^= BigInt(b); h = (h * prime) & 0xffffffffffffffffn; }
  return h;
}

(async () => {
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(WASM_PATH));
  const e = instance.exports;
  ok("abi version", e.lunix_abi() === 1);
  const vptr = e.lunix_version_ptr(), vlen = e.lunix_version_len();
  ok("version string", /lunix-core 0\.1\.0/.test(Buffer.from(e.memory.buffer, vptr, vlen).toString()));

  // byte-for-byte parity with GNU coreutils cksum on this machine
  const cases = ["", "hello lunix\n", "a", "the quick brown fox jumps over the lazy dog",
    "x".repeat(4096), JSON.stringify({ lunix: true, shells: 3 })];
  let allMatch = true;
  for (const c of cases) {
    const data = Buffer.from(c, "utf8");
    const tmp = path.join(os.tmpdir(), "ck_" + Math.random().toString(36).slice(2));
    fs.writeFileSync(tmp, data);
    const want = parseInt(cp.execSync(`cksum ${tmp}`).toString());
    fs.unlinkSync(tmp);
    const ptr = e.lunix_mem_alloc(Math.max(data.length, 1));
    new Uint8Array(e.memory.buffer, ptr, data.length).set(data);
    const got = e.lunix_cksum(ptr, data.length) >>> 0;
    if (got !== want) { allMatch = false; console.log(`    mismatch on ${JSON.stringify(c.slice(0, 18))}: got ${got} want ${want}`); }
    e.lunix_mem_reset();
  }
  ok(`posix cksum matches GNU coreutils (${cases.length} inputs)`, allMatch);

  const ref = fnv1a64ref(Buffer.from("hello lunix\n"));
  const ptr = e.lunix_mem_alloc(12);
  new Uint8Array(e.memory.buffer, ptr, 12).set(Buffer.from("hello lunix\n"));
  const got = BigInt.asUintN(64, e.lunix_fnv1a64(ptr, 12));
  ok("fnv1a64 matches pure-js reference", got === ref, `${got.toString(16)} vs ${ref.toString(16)}`);
  e.lunix_mem_reset();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("ERR", e); process.exit(2); });
