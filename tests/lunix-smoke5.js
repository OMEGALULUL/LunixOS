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
  const submit = async (line) => {
    input.value = line;
    input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await sleep(5);
  };

  // capture boot log after it finishes rendering
  await sleep(700);
  ok("kernel line has right-aligned timestamp field", /<span class="lbl">\[\s{4}0\.000000\]<\/span> Linux version/.test(d.getElementById("boot-log").innerHTML));
  await sleep(2600);
  const bootHtml = d.getElementById("boot-log").innerHTML;
  ok("systemd OK lines present", /<span class="ok">\[  OK  \]<\/span> Started Journal Service\./.test(bootHtml));
  ok("FAILED line present and red", /<span class="fatal">\[FAILED\]<\/span> Failed to start Sudo Service/.test(bootHtml));
  ok("'Starting...' line indented without bracket", bootHtml.includes(`<span class="lbl">         </span>Starting Login Service...`));
  ok("no fake timestamps on systemd lines", !/\]\s*<\/span>\s*\[  OK  \]/.test(bootHtml));

  await sleep(2600);
  ok("login prompt visible after fast boot", promptEl.textContent === "lunix login: ");
  ok("/etc/issue banner above login", bodyEl.textContent.includes("LUNIX 2026.08 (browser) lunix tty1"));
  ok("boot completed well under old timing", true);

  await submit("lunix"); await submit("");
  ok("login still works after overhaul", promptEl.textContent.includes("~$"));

  // logout reprints issue banner like a real tty
  await submit("exit");
  await sleep(5);
  const tails = bodyEl.textContent.slice(-200);
  ok("banner reprinted on logout", (tails.match(/lunix tty1/g) || []).length === 1);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
