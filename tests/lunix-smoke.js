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
  // silence jsdom "not implemented" noise
  w.addEventListener("error", () => {});
  const input = doc.getElementById("vt-input");
  const bodyEl = doc.getElementById("vt-body");
  const promptEl = doc.getElementById("vt-prompt");
  const outText = () => bodyEl.textContent;
  const lastOut = () => {
    const kids = [...bodyEl.children];
    return kids.length ? kids[kids.length - 1].textContent : "";
  };
  const submit = async (line) => {
    input.value = line;
    input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await sleep(5);
  };

  console.log("boot:");
  ok("boot overlay present", !!doc.getElementById("boot"));
  await sleep(280 * 11 + 900); // BOOT_LINES + final pause
  ok("boot overlay done", doc.getElementById("boot").classList.contains("done"));
  ok("login prompt shown", promptEl.textContent === "lunix login: ");
  ok("mirror engine enabled", doc.documentElement.classList.contains("mirror"));
  ok("titlebar text synced", doc.getElementById("wt-title").textContent === "lunix login:");

  console.log("login:");
  await submit("lunix");
  ok("no password step — straight to last-login + motd", outText().includes("Last login:") && outText().includes("welcome to lunix"));
  await submit("");
  ok("prompt is user@lunix:~$", promptEl.textContent.includes("lunix@lunix") && promptEl.textContent.includes("~$"));
  ok("window title updated", doc.getElementById("wt-title").textContent === "lunix@lunix: ~");

  console.log("filesystem:");
  await submit("mkdir -p projects/web && touch projects/web/app.js && echo hi > notes.txt");
  await submit("ls");
  ok("ls shows projects + notes.txt", outText().includes("projects") && bodyEl.textContent.includes("notes.txt"));
  await submit("ls -l");
  const ll = [...bodyEl.children].map(c => c.textContent).join("\n");
  ok("ls -l has total line", /\btotal \d+\b/.test(ll));
  ok("ls -l has perms + date columns", /drwxr-xr-x\s+[12]\s+lunix\s+lunix\s+4096\s+[A-Z][a-z]{2}\s+\d{2}\s+\d{2}:\d{2}/.test(ll));
  ok("dir colored blue in ls -l", [...bodyEl.children].some(c => c.innerHTML.includes('class="blue"')));

  console.log("cd + title:");
  await submit("cd projects");
  ok("prompt follows cd", promptEl.textContent.includes("~/projects$"));
  ok("titlebar follows cd", doc.getElementById("wt-title").textContent === "lunix@lunix: ~/projects");
  await submit("cd");

  console.log("tab completion:");
  input.value = "mkd";
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  ok("command completion mkd->mkdir ", input.value === "mkdir ");
  input.value = "cat /etc/hos";
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  ok("path completion /etc/hos->hostname", input.value === "cat /etc/hostname ");
  input.value = "cd pro";
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  ok("relative dir completion appends /", input.value === "cd projects/");
  input.value = "zzz";
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  ok("no match rings bell (no crash)", typeof input.value === "string");

  console.log("history:");
  await submit("echo one");
  await submit("echo two");
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
  ok("up -> last command", input.value === "echo two");
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
  ok("up again -> earlier command", input.value === "echo one");
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  ok("down -> forward again", input.value === "echo two");
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  ok("down past end restores draft", input.value === "");
  await submit("");

  console.log("ctrl keys:");
  input.value = "to be cancelled";
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true }));
  ok("Ctrl-C echoes ^C and clears line", lastOut().includes("^C") && input.value === "");
  await submit("echo visible");
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "l", ctrlKey: true, bubbles: true, cancelable: true }));
  ok("Ctrl-L clears screen", bodyEl.children.length === 0);
  input.value = "kill this word here";
  input.setSelectionRange(9, 9);
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "w", ctrlKey: true, bubbles: true, cancelable: true }));
  ok("Ctrl-W kills word before caret", !input.value.includes("this") && input.value.includes("word"));
  input.value = "keepme";
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true, cancelable: true }));
  ok("Ctrl-D ignored while line non-empty", promptEl.textContent.includes("$"));

  console.log("reverse search:");
  input.value = "";
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "r", ctrlKey: true, bubbles: true, cancelable: true }));
  ok("search prompt label", promptEl.textContent.includes("(reverse-i-search)"));
  for (const ch of "two") input.dispatchEvent(new w.KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true }));
  ok("found matching hist entry", input.value === "echo two");
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  ok("escape restores original line", input.value === "");
  ok("prompt restored after search", promptEl.textContent.includes("$"));

  console.log("ctrl-d logout:");
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true, cancelable: true }));
  await sleep(5);
  ok("back at login prompt", promptEl.textContent === "lunix login: ");

  console.log("window buttons:");
  const win = doc.getElementById("appwin");
  doc.querySelector('[data-wbtn="max"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok("maximize toggles .max", win.classList.contains("max"));
  doc.querySelector('[data-wbtn="max"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok("maximize toggles back", !win.classList.contains("max"));
  doc.querySelector('[data-wbtn="min"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok("minimize hides window", win.classList.contains("minimized"));
  ok("dock pill appears", doc.getElementById("dockpill").classList.contains("on"));
  doc.getElementById("dockpill").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok("pill restores window", !win.classList.contains("minimized"));

  console.log("tmux bar:");
  ok("uptime ticking", /\d+s|\d+m/.test(doc.getElementById("t-up").textContent));
  ok("clock format", /^\d{2}:\d{2}$/.test(doc.getElementById("t-clk").textContent));
  ok("session id shown", doc.getElementById("t-sid").textContent.startsWith("#"));
  ok("pkgs count present", /^\d+$/.test(doc.getElementById("t-pk").textContent));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
