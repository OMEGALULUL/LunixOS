const fs = require("fs");
const { JSDOM } = require("jsdom");
const html = fs.readFileSync("/home/linux/Desktop/LunixOS-main/index.html", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log("  ok - " + n); } else { fail++; console.log("  FAIL - " + n); } };

(async () => {
  const dom = new JSDOM(html, {
    url: "https://lunix.blueberryservices.co.za/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(w) { w.fetch = () => Promise.reject(new Error("offline")); w.confirm = () => true; },
  });
  const w = dom.window, d = w.document;
  const input = d.getElementById("vt-input");
  const bodyEl = d.getElementById("vt-body");
  const promptEl = d.getElementById("vt-prompt");
  const outText = () => bodyEl.textContent;
  const submit = async (line) => {
    input.value = line;
    input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await sleep(5);
  };
  const key = (k, opts) => input.dispatchEvent(new w.KeyboardEvent("keydown", Object.assign({ key: k, bubbles: true, cancelable: true }, opts)));

  await sleep(280 * 12 + 900); // boot (now 10 lines)
  await submit("lunix"); await submit("");
  ok("logged in", promptEl.textContent.includes("$"));

  console.log("login without password:");
  // log out first so we can test re-login
  await submit("exit");
  ok("exit returns to login", promptEl.textContent === "lunix login: ");
  await submit("lunix");
  ok("relogin lands straight on the prompt", promptEl.textContent.includes("~$"));
  await submit("exit");

  console.log("exps lock password cancel:");
  await submit("lunix"); await submit("");   // back in
  await submit("exps lock");
  const noCrypto = outText().includes("needs WebCrypto");
  if (noCrypto) {
    // jsdom has no crypto.subtle — LUNIX correctly refuses sealed exports here
    ok("secure-context guard fired (jsdom lacks WebCrypto)", true);
    ok("input untouched by guard", input.type === "text");
  } else {
    ok("lock prompt printed", outText().includes("enter password"));
    ok("hidden input", input.type === "password");
    key("c", { ctrlKey: true });
    await sleep(5);
    ok("cancel returns to SHELL prompt (not login)", promptEl.textContent.includes("$"));
    ok("input visible again", input.type === "text");
  }

  console.log("nano:");
  await submit("echo hello > note.txt");
  await submit("nano note.txt");
  ok("nano overlay opens inside terminal", !!d.getElementById("nano-ed"));
  const ta = d.getElementById("nano-ed").querySelector("textarea");
  ok("buffer has file content", ta.value === "hello\n");
  ta.value = "hello edited";
  ta.dispatchEvent(new w.KeyboardEvent("keydown", { key: "o", ctrlKey: true, bubbles: true, cancelable: true }));
  ok("^O writes", outText().includes("wrote 1 line(s)"));
  ta.dispatchEvent(new w.KeyboardEvent("keydown", { key: "x", ctrlKey: true, bubbles: true, cancelable: true }));
  await sleep(5);
  ok("^X closes editor", !d.getElementById("nano-ed"));
  await submit("cat note.txt");
  ok("edit persisted", outText().includes("hello edited"));

  console.log("apk + tool gating still fine:");
  await submit("htop");
  ok("uninstalled tool gated", outText().includes("command not found"));
  await submit("apk add htop && htop");
  ok("installed tool lights up", outText().includes("/usr/bin/pretend"));

  console.log("reboot:");
  await submit("reboot");
  await sleep(280 * 12 + 900);
  ok("back at login after reboot", promptEl.textContent === "lunix login: ");
  ok("session survived reboot (refresh-keeps-state)", (() => {
    const st = JSON.parse(dom.window.sessionStorage.getItem("lunix-state") || "{}");
    return st.pkgs && st.pkgs.htop === true;
  })());

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
