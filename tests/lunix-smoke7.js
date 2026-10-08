const fs = require("fs");
const { JSDOM } = require("jsdom");
const html = fs.readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8");
const slux = fs.readFileSync(require("path").join(__dirname, "..", "tools", "snake.slux"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? pass++ : fail++; console.log((c ? "  ok - " : "  FAIL - ") + n + (c && !extra ? "" : " " + (extra || ""))); };

(async () => {
  const dom = new JSDOM(html, { url: "https://lunix.blueberryservices.co.za/", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) { w.fetch = () => Promise.reject(new TypeError("offline")); w.confirm = () => false; } });
  const w = dom.window, d = w.document;
  const input = d.getElementById("vt-input");
  const bodyEl = d.getElementById("vt-body");
  const submit = async (line) => {
    input.value = line;
    input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await sleep(5);
  };
  const lastOut = () => [...bodyEl.children].pop().textContent;
  const key = (k, opts) => d.dispatchEvent(new w.KeyboardEvent("keydown", Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {})));

  for (let i = 0; i < 200 && bodyEl.textContent.indexOf("lunix login:") === -1; i++) await sleep(100);
  await submit("lunix");
  await sleep(300);

  // install the tool the same way boot does
  w.fs["/usr/bin/snake.slux"] = { type: "file", data: slux };
  if (w.fs["/usr/bin"] && w.fs["/usr/bin"].kids && w.fs["/usr/bin"].kids.indexOf("snake.slux") === -1) w.fs["/usr/bin"].kids.push("snake.slux");
  w.loadInstalled();

  console.log("install:");
  ok("snake command registered", typeof w.CMDS.snake === "function");
  await submit("snake --help");
  ok("help prints usage", lastOut().indexOf("arrow keys steer") !== -1);

  console.log("gameplay:");
  await submit("snake");
  let board = d.querySelector("[data-snake-board]");
  ok("board renders", !!board && board.innerHTML.indexOf("██") !== -1);
  const before = board.innerHTML;
  await sleep(450); // ~3 ticks at 140ms
  ok("snake moves on its own", d.querySelector("[data-snake-board]").innerHTML !== before);
  ok("double start is rejected", (await submit("snake"), lastOut()).indexOf("already running") !== -1);

  // arrow capture: our capture-phase handler eats arrows while playing
  let probePrevented = null;
  const probe = (e) => { probePrevented = e.defaultPrevented; };
  d.addEventListener("keydown", probe, true);
  key("ArrowUp"); await sleep(10);
  ok("arrow keys are captured while playing", probePrevented === true);
  key("x");
  ok("normal typing passes through", probePrevented === false);
  d.removeEventListener("keydown", probe, true);

  console.log("death & persistence:");
  let over = false;
  for (let i = 0; i < 90; i++) { // head starts right of center heading right → wall in ~3.5s
    if ((d.querySelector("[data-snake-board]") || { textContent: "" }).textContent.indexOf("GAME OVER") !== -1) { over = true; break; }
    await sleep(100);
  }
  ok("wall collision ends the game", over);
  ok("best score persisted to ~/.snake", !!(w.fs["/home/lunix/.snake"] && parseInt(w.fs["/home/lunix/.snake"].data, 10) >= 0));

  await submit("snake");
  const boards = d.querySelectorAll("[data-snake-board]");
  ok("retry leaves exactly one live board (corpse removed)", boards.length === 1, "found " + boards.length);
  const reborn = boards[0] ? boards[0].innerHTML : "";
  await sleep(450);
  const nowBoard = d.querySelector("[data-snake-board]");
  ok("retried game is alive and moving", !!nowBoard && nowBoard.textContent.indexOf("GAME OVER") === -1 && nowBoard.innerHTML !== reborn);
  await submit("snake stop");
  await sleep(50);
  ok("snake stop abandons the round", lastOut().indexOf("abandoned") !== -1);
  ok("arrows free again after stop", (key("ArrowLeft"), probePrevented = null, d.addEventListener("keydown", probe, true), key("ArrowUp"), d.removeEventListener("keydown", probe, true), probePrevented) === false);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
