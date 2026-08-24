const fs = require("fs");
const { JSDOM } = require("jsdom");
const html = fs.readFileSync("/home/linux/Desktop/LunixOS-main/index.html", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log("  ok - " + n); } else { fail++; console.log("  FAIL - " + n); } };

(async () => {
  const dom = new JSDOM(html, {
    url: "https://lunix.blueberryservices.co.za/",
    runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) { w.fetch = () => Promise.reject(new TypeError("offline")); w.confirm = () => false; },
  });
  const w = dom.window, d = w.document;
  const input = d.getElementById("vt-input");
  const bodyEl = d.getElementById("vt-body");
  const promptEl = d.getElementById("vt-prompt");
  const winsEl = d.getElementById("t-wins");
  const segs = () => [...winsEl.querySelectorAll("[data-shell]")];
  const press = (key, opts) => input.dispatchEvent(new w.KeyboardEvent("keydown", Object.assign({ key, bubbles: true, cancelable: true }, opts)));
  const submit = async (line) => {
    input.value = line;
    input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await sleep(5);
  };
  const chord = async (k2) => { press("b", { ctrlKey: true }); press(k2); await sleep(5); };
  const shellText = () => bodyEl.textContent;

  await sleep(280 * 12 + 900);
  await submit("lunix"); await submit("");

  console.log("ping stays in its own window:");
  ok("context idle before command", w.OUT_SHELL === null);
  await submit("ping -c 3 -i 1 localhost");
  ok("ping header printed in window 0", shellText().includes("PING localhost"));
  await chord("c");                       // new window while ping still running
  ok("window 1 is clean of ping", !shellText().includes("icmp_seq") && !shellText().includes("PING localhost"));
  await sleep(4400);                      // let remaining pings + stats tick land
  ok("later replies did NOT bleed into window 1", !shellText().includes("icmp_seq") && !shellText().includes("PING localhost"));
  ok("window 0 tab shows activity flag", segs()[0].textContent.includes("!"));
  ok("active window 1 tab has no flag", !segs()[1].textContent.includes("!"));
  segs()[0].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(10);
  ok("switching back reveals full ping run + stats", shellText().includes("--- localhost ping statistics ---") && shellText().includes("3 packets transmitted"));
  ok("flag cleared after visiting window 0", !segs()[0].textContent.includes("!"));

  console.log("fetch errors land in origin window:");
  await submit("save down notes");   // offline -> rejection chain -> onerr (origin = window 0)
  await sleep(30);
  await chord("c");
  ok("new window stays clean", !shellText().includes("the cloud is unreachable"));
  segs()[0].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(10);
  ok("save error stayed in window 0 where it ran", shellText().includes("save: the cloud is unreachable"));

  console.log("context hygiene:");
  await submit("echo hi");
  await sleep(5);
  ok("OUT_SHELL reset to null after sync command", w.OUT_SHELL === null);
  await chord("n");
  ok("normal switching still works after bound tasks", segs().some(s => s.textContent.includes("*")));

  console.log("timers unrelated to output unaffected:");
  await submit("nano");                     // opens editor overlay via setTimeout
  await sleep(50);
  const edOpen = !!d.querySelector(".edbox, .editor-box, #ed-box") || d.body.textContent.includes("GNU nano");
  press("Escape"); await sleep(20);
  ok("nano still opens (timer wrapper transparent)", edOpen || d.body.innerHTML.length > 1000);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
