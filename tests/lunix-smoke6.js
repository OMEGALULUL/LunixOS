const fs = require("fs");
const { JSDOM } = require("jsdom");
const html = fs.readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8");
const wasm = fs.readFileSync(require("path").join(__dirname, "..", "assets", "lunix_core.wasm"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? pass++ : fail++; console.log((c ? "  ok - " : "  FAIL - ") + n + (c && !extra ? "" : " " + (extra || ""))); };

(async () => {
  const dom = new JSDOM(html, { url: "https://lunix.blueberryservices.co.za/", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      // real WebAssembly; fetch serves the local wasm asset, everything else offline
      w.WebAssembly = WebAssembly;
      w.TextEncoder = TextEncoder; // jsdom gap; every real browser ships it
      w.fetch = (u) => String(u).indexOf("assets/lunix_core.wasm") !== -1
        ? Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)) })
        : Promise.reject(new TypeError("offline"));
      w.confirm = () => false;
    } });
  const w = dom.window, d = w.document;
  const input = d.getElementById("vt-input");
  const bodyEl = d.getElementById("vt-body");
  const outText = () => bodyEl.textContent;
  const submit = async (line) => {
    input.value = line;
    input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await sleep(5);
  };
  const lastOut = () => [...bodyEl.children].pop().textContent;
  const waitText = async (needle, tries) => {
    for (let i = 0; i < (tries || 100); i++) { if (outText().indexOf(needle) !== -1) return true; await sleep(120); }
    return false;
  };

  await waitText("lunix login:");
  ok("boot reaches login prompt", true);
  await submit("lunix");
  await waitText("everything you install dies");

  console.log("native core:");
  ok("wasm module loads and registers CORE", typeof w.CORE === "object" && !!w.CORE.lunix_cksum);
  await submit("echo abc > b.txt");
  await submit("echo hello lunix > h.txt");
  await submit("cksum b.txt");
  ok("cksum matches GNU coreutils value", lastOut() === "1112837078 4 b.txt", lastOut());
  await submit("cksum h.txt");
  ok("cksum byte-accurate with spaces + newline", lastOut() === "2501845292 12 h.txt", lastOut());
  await submit("cksum nope.txt");
  ok("missing file error is authentic", lastOut() === "cksum: nope.txt: No such file or directory");
  await submit("cksum");
  ok("missing operand handled", lastOut() === "cksum: missing operand");
  await submit("cksum h.txt b.txt");
  const twoLines = lastOut().split("\n");
  ok("multiple files in one call", twoLines.length === 2 && / h\.txt$/.test(twoLines[0]) && / b\.txt$/.test(twoLines[1]) && twoLines[0] !== twoLines[1], JSON.stringify(lastOut()));
  await submit("help");
  ok("help lists cksum", outText().indexOf("cksum") !== -1);

  console.log("graceful degradation (wasm unavailable):");
  const dom2 = new JSDOM(html, { url: "https://lunix.blueberryservices.co.za/", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) { w.fetch = () => Promise.reject(new TypeError("offline")); w.confirm = () => false; } });
  const w2 = dom2.window, d2 = dom2.window.document;
  const input2 = d2.getElementById("vt-input");
  const bodyEl2 = d2.getElementById("vt-body");
  const submit2 = async (line) => {
    input2.value = line;
    input2.dispatchEvent(new w2.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await sleep(5);
  };
  for (let i = 0; i < 200 && bodyEl2.textContent.indexOf("lunix login:") === -1; i++) await sleep(100);
  input2.value = "lunix";
  input2.dispatchEvent(new w2.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await sleep(300);
  await submit2("echo data > f.txt");
  await submit2("cksum f.txt");
  const last2 = () => [...bodyEl2.children].pop().textContent;
  // the deferred CORE_READY check must land on the honest error, never a crash
  for (let i = 0; i < 40 && String(last2()).indexOf("lunix-core") === -1; i++) await sleep(50);
  ok("honest error instead of breakage", /lunix-core\.wasm unavailable/.test(last2()), last2());
  await submit2("ls f.txt");
  ok("terminal keeps working after failed core", last2() === "data\n", JSON.stringify(last2()));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
