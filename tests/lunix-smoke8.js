const fs = require("fs");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync("/home/linux/Desktop/LunixOS-main/index.html", "utf8");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ok - " + name); }
  else { fail++; console.log("  FAIL - " + name); }
}

(async () => {
  const dom = new JSDOM(html, {
    url: "https://lunix.blueberryservices.co.za/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error("offline"));
      window.confirm = () => false;
    },
  });
  const w = dom.window;
  const doc = w.document;
  w.addEventListener("error", () => {});
  const input = doc.getElementById("vt-input");
  const bodyEl = doc.getElementById("vt-body");
  const outText = () => bodyEl.textContent;
  const inPath = (p) => outText().indexOf(p) !== -1;
  const flag = () => doc.defaultView.sessionStorage.getItem("lunix-console");
  const submit = async (line) => {
    input.value = line;
    input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await sleep(5);
  };

  console.log("console mode:");
  ok("console mode is ON by default (no flag set)",
    doc.documentElement.classList.contains("console"));
  await sleep(280 * 11 + 900); // wait out the boot overlay
  await submit("lunix");        // log in so the prompt accepts commands

  await submit("console");
  ok("console flips it OFF", !doc.documentElement.classList.contains("console"));
  ok("mode flag stored as off", flag() === "0");
  ok("told us it is off", inPath("console mode: off"));

  await submit("console on");
  ok("console on turns it back ON", doc.documentElement.classList.contains("console"));
  ok("mode flag stored as on", flag() === "1");

  await submit("console -h");
  ok("-h shows usage", inPath("console [on|off]"));
  ok("flag untouched by -h", flag() === "1");

  // reload with an explicit "0" -> window mode must come back
  const dom2 = new JSDOM(html, {
    url: "https://lunix.blueberryservices.co.za/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.sessionStorage.setItem("lunix-console", "0");
      window.fetch = () => Promise.reject(new Error("offline"));
      window.confirm = () => false;
    },
  });
  ok("reload with stored off -> window mode (not console)",
    !dom2.window.document.documentElement.classList.contains("console"));

  const dom3 = new JSDOM(html, {
    url: "https://lunix.blueberryservices.co.za/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.sessionStorage.setItem("lunix-console", "1");
      window.fetch = () => Promise.reject(new Error("offline"));
      window.confirm = () => false;
    },
  });
  ok("reload with stored on -> console mode",
    dom3.window.document.documentElement.classList.contains("console"));

  await submit("help");
  ok("help mentions console", inPath("console"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });