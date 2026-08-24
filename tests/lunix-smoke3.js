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
    beforeParse(w) { w.fetch = () => Promise.reject(new Error("offline")); w.confirm = () => false; },
  });
  const w = dom.window, d = w.document;
  const input = d.getElementById("vt-input");
  const bodyEl = d.getElementById("vt-body");
  const promptEl = d.getElementById("vt-prompt");
  const winsEl = d.getElementById("t-wins");
  const segs = () => [...winsEl.querySelectorAll("[data-shell]")];
  const submit = async (line) => {
    input.value = line;
    input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await sleep(5);
  };
  const chord = async (a, b) => { // tmux prefix chord
    input.dispatchEvent(new w.KeyboardEvent("keydown", { key: a, ctrlKey: a.length > 1 && a.startsWith("C") ? false : false, bubbles: true }));
    process.stdout.write("");
  };
  const press = (key, opts) => input.dispatchEvent(new w.KeyboardEvent("keydown", Object.assign({ key, bubbles: true, cancelable: true }, opts)));

  await sleep(280 * 12 + 900);
  await submit("lunix"); await submit("");

  console.log("initial:");
  ok("one window segment at boot", segs().length === 1);
  ok("segment labelled 0:bash*", segs()[0].textContent === "0:bash*");

  console.log("create via Ctrl-B c:");
  press("b", { ctrlKey: true });
  ok("prefix arms the bar", d.getElementById("t-bar").classList.contains("armed"));
  press("c");
  await sleep(5);
  ok("two windows now", segs().length === 2);
  ok("new window is active (1:bash*)", segs()[1].textContent === "1:bash*" && segs()[0].textContent === "0:bash-");
  ok("fresh blank screen in new shell", bodyEl.children.length <= 1);
  ok("prompt ready in new shell", promptEl.textContent.includes("~$"));

  console.log("independent state per shell:");
  await submit("mkdir -p shared && cd shared");
  ok("shell1 cwd moved", promptEl.textContent.includes("~/shared$"));
  input.value = "draft text";
  // switch by clicking segment 0
  segs()[0].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(5);
  ok("clicked back to window 0", segs()[0].textContent === "0:bash*" && promptEl.textContent.includes("~$"));
  ok("shell0 kept its scrollback", bodyEl.textContent.includes("welcome to lunix"));
  ok("shell1 draft not visible here", input.value !== "draft text");
  await submit("pwd");
  ok("shell0 still at ~", [...bodyEl.children].pop().textContent.trim() === "/home/lunix");
  segs()[1].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(5);
  ok("switch to 1 restores cwd", promptEl.textContent.includes("~/shared$"));
  ok("switch to 1 restores draft line", input.value === "draft text");
  await submit("pwd");
  ok("shell1 pwd is ~/shared", [...bodyEl.children].pop().textContent.trim() === "/home/lunix/shared");

  console.log("ctrl-b digits + n/p cycling:");
  press("b", { ctrlKey: true }); press("0");
  await sleep(5);
  ok("Ctrl-B 0 jumps to window 0", segs()[0].textContent.includes("*"));
  press("b", { ctrlKey: true }); press("n");
  await sleep(5);
  ok("Ctrl-B n wraps to window 1", segs()[1].textContent.includes("*"));
  press("b", { ctrlKey: true }); press("p");
  await sleep(5);
  ok("Ctrl-B p back to window 0", segs()[0].textContent.includes("*"));
  press("b", { ctrlKey: true }); press("9");
  await sleep(5);
  ok("Ctrl-B 9 with no window 9 rings bell only", segs().some(s => s.textContent.includes("*")));

  console.log("+ button and cap:");
  d.querySelector("[data-newwin]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(5);
  ok("+ button created window 2", segs().length === 3);
  for (let i = 0; i < 12; i++) { press("b", { ctrlKey: true }); press("c"); }
  await sleep(5);
  ok("window cap at 10 enforced", segs().length === 10);

  console.log("exit closes one window:");
  await submit("exit");
  await sleep(5);
  ok("exit closed current -> 9 left", segs().length === 9);
  ok("landed on neighbour window", segs().some(s => s.textContent.includes("*")));
  await submit("exit"); await submit("exit");
  await sleep(5);
  ok("down to 7 windows", segs().length === 7);

  console.log("persistence shape:");
  const saved = JSON.parse(dom.window.sessionStorage.getItem("lunix-state"));
  ok("shells persisted", Array.isArray(saved.shells) && saved.shells.length === 7);
  ok("active index persisted", typeof saved.act === "number" && saved.act >= 0 && saved.act < 7);
  ok("per-shell hist persisted", saved.shells.every(s => Array.isArray(s.hist)));

  console.log("last exit goes to login:");
  while (segs().length > 1) { await submit("exit"); await sleep(3); }
  await submit("exit");
  await sleep(5);
  ok("final exit reaches login prompt", promptEl.textContent === "lunix login: ");

  console.log("mobile + key:");
  await submit("lunix"); await submit("");
  d.querySelector('[data-key="newshell"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(5);
  ok("keys-row + opens second shell", segs().length === 2);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
