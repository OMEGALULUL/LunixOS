# .slux syntax manual

the complete reference for writing LUNIX tools. a `.slux` file is a plain text file in three parts — a **meta header**, a **bash section**, and a **code section** — that anyone can install inside LUNIX with `download <name>`. no build step, no dependencies, no framework: one file, two languages.

new here? read [anatomy](#1-anatomy) and [the globals table](#6-the-globals-you-can-use), then copy the [annotated example](#10-annotated-example). the quick version lives in [README.md](README.md).

---

## table of contents

1. [anatomy](#1-anatomy)
2. [the meta header](#2-the-meta-header)
3. [the bash section](#3-the-bash-section)
4. [the code section](#4-the-code-section)
5. [arguments & flags](#5-arguments--flags)
6. [the globals you can use](#6-the-globals-you-can-use)
7. [output, async & long-running tasks](#7-output-async--long-running-tasks)
8. [the filesystem & binary data](#8-the-filesystem--binary-data)
9. [lifecycle, storage & uninstall](#9-lifecycle-storage--uninstall)
10. [annotated example](#10-annotated-example)
11. [security model](#11-security-model)
12. [testing your tool](#12-testing-your-tool)
13. [publishing](#13-publishing)
14. [gotchas checklist](#14-gotchas-checklist)

---

## 1. anatomy

```
#slux name hello            ← meta header (directives, one per line)
#slux desc "says hello"
#slux version 1.0.0

mkdir -p /usr/bin           ← bash section (runs once, on install)
echo "hi" > /usr/bin/hello.README.txt

#slux code                  ← code section (runs on install, then lives as the command)
register("hello", function (args) {
  print("hello, " + (args[0] || "world"));
});
```

parsing rules (exactly how the installer reads your file):

| line | meaning |
|---|---|
| starts with `#slux ` | a directive. before the code marker it sets metadata |
| `#slux code` | switches to the code section — everything after is JavaScript |
| anything else **before** `#slux code` | a bash install line (blank lines ignored) |
| anything **after** `#slux code` | JavaScript, verbatim |

nothing else is significant — no indentation rules, no closing markers, plain UTF-8 text, `.slux` extension, filename must match the `name` directive.

## 2. the meta header

```
#slux name nmap
#slux desc "network exploration tool and security / port scanner"
#slux version 1.0.0
```

| directive | required | rules |
|---|---|---|
| `name` | yes | the command name. **must equal the filename** without `.slux` (`nmap.slux` → `nmap`). lowercase, no spaces |
| `desc` | yes | one line, double-quoted. shown by `gitshop` and used in listings |
| `version` | yes | semver (`1.0.0`). bump it on every change so re-downloads are obvious |

reserved: `#slux media <file,file>` is written by `exps` into exported `session.slux` files. do not use it in tools.

if `name` is missing the installer falls back to the filename — but write it anyway; a file that disagrees with its header is a bug.

## 3. the bash section

everything between the header and `#slux code` is **LUNIX bash, executed line by line, top to bottom, once, at install time — before your code runs**. its job is laying down files, directories and dependencies so the command arrives to a prepared system.

```
mkdir -p /usr/bin
apk add jq
echo "jq is installed. good for you." > /usr/bin/mytool.README.txt
cp /etc/motd /usr/share/motd.bak && echo "backed up"
```

- any command the sim ships works: `mkdir -p`, `touch`, `echo` (with `>` / `>>`), `cp`, `mv`, `rm`, `apk add`, `ls`, `cat`, `&&` chains, redirection
- each line is a separate command dispatch — write complete lines
- **failures are swallowed** (a line that errors just doesn't do its thing, install continues) — so keep lines idempotent: `mkdir -p`, never bare `mkdir`
- it runs against the live session: current cwd, current user, already-installed packages. a second `download` re-runs it — make it safe to run twice
- this is where `/usr/bin` files, config files, and README easter eggs come from

## 4. the code section

after `#slux code`, plain browser JavaScript. there are no modules, no `import`/`require`, no node APIs — one scope, the browser. ES5-style (like every existing tool) is the house style; anything the browser supports works.

the contract is one line: **call `register(name, fn)`**.

```
#slux code
register("hello", function (args) {
  print("hello, " + (args[0] || "world"));
});
```

- `name` should match the header/filename (this is what `download rm <name>` deletes, and what tab completion offers)
- `args` — see [§5](#5-arguments--flags)
- you may `register()` more than one command from one file (rare but legal)
- helpers: define them **inside** your callback (or as `function` declarations) so re-install/reload behaves — the file is re-evaluated on every reload
- a **throw during eval fails the install** with `download: <name> failed to install: <error>` — your bash section's side effects remain, so make them idempotent
- after install your function is just a normal command: reachable from the prompt, from `&&` chains, from `CMDS`, until uninstalled

**return early for usage errors** — `return` inside the callback stops the command:

```js
if (!args[0]) return err("hello: need a name");
```

## 5. arguments & flags

`args` is the array of tokens after your command name, **quotes already stripped** by the shell:

| typed | args |
|---|---|
| `hello world` | `["world"]` |
| `hello "big bang"` | `["big bang"]` |
| `tool -v -p 80 host` | `["-v", "-p", "80", "host"]` |
| `tool` | `[]` |

conventions every good tool follows (see `ping`, `nmap`, `dig`):

```js
var opts = { verbose: false, port: null, host: null };
for (var i = 0; i < args.length; i++) {
  var a = args[i];
  if (a === "-h" || a === "--help") return print(usage());
  else if (a === "-v") opts.verbose = true;
  else if (a === "-p") opts.port = parseInt(args[++i], 10);
  else if (a.charAt(0) === "-") return err("mytool: unknown option '" + a + "'");
  else opts.host = a;                       // first bare token wins
}
```

- always support `-h` / `--help` with a real usage block — `download`'s ecosystem shows it
- unknown flags should **error, never be ignored** — silent acceptance is how tools become confusing
- subcommands: just compare `args[0]` (`wids log`, `music stop`, `save up`)

## 6. the globals you can use

your code runs inside the terminal's page with the whole sim in scope. the **stable API** (everything the shipped tools rely on):

### output

| global | what it does |
|---|---|
| `print(s)` | print one line — HTML-escaped (use it for text, always) |
| `err(s)` | print one line, shaped as an error |
| `printHtml(html)` | print raw html — **you escape anything dynamic** with `esc()` |
| `esc(s)` | html-escape a string (`&`, `<`, `>`) |

### registering

| global | what it does |
|---|---|
| `register(name, fn)` | make `name` a runnable command (alias: it writes `CMDS[name]`) |

### the session

| global | what it is |
|---|---|
| `fs` | the virtual filesystem — a map of absolute paths: `fs["/path"] = {type:"file", data:"..."}`, dirs carry `kids: ["a","b"]` (children as leaves). treat as read-mostly; call `saveState()` after structural edits |
| `cwd` | current working directory string (e.g. `/home/lunix`) |
| `user` | `"lunix"` or `"root"` |
| `pkgs` | installed apk packages: `{ "jq": true, ... }` |
| `CMDS` | the live command map — read it to check what exists (`CMDS.grep`), don't overwrite others' commands |

### path helpers

| global | what it does |
|---|---|
| `resolve(p)` | resolve `p` against `cwd` (handles `~`, `.`, `..`, relative) |
| `norm(p)` | normalize the result (`//` → `/`, trailing slash) |
| `parent(p)` / `leaf(p)` | directory part / final component |
| `exists(p)` | does the path exist? |
| `typeOf(p)` | `"file"` / `"dir"` / `null` |

### running the shell

| global | what it does |
|---|---|
| `handleCmd(line)` | run a shell line programmatically (prints, chains, redirection — full pipeline) |
| `saveState()` | persist fs/pkgs/etc. to sessionStorage — call it after changing `fs` by hand |

### the browser

| global | what it does |
|---|---|
| `fetch(...)` | real network — CORS rules of the browser apply. known-good CORS-open endpoints: `dns.google/resolve`, `cloudflare-dns.com/dns-query`, `api.github.com` |
| `setTimeout` / `setInterval` / `Promise` | normal browser primitives — **output from their callbacks is auto-routed back to your window** (see §7) |
| `downloadBytes(name, bytes, mime)` | push bytes straight to the user's device as a download — nothing enters the fs or the bucket (the `ytc` pattern) |
| `confirm(msg)` | native yes/no dialog (synchronous, use sparingly) |

**not** yours: session storage internals (`sessionStorage` keys), the worker's credentials helpers, other commands' private variables. reach for the table above; if it's not there, it's not stable API.

## 7. output, async & long-running tasks

the sim is tmux-style: output belongs to the window that spawned the command, even if the user switches windows mid-flight. this is automatic —

- `setTimeout`, `setInterval` and `Promise.then` callbacks are wrapped so `print()` inside them lands in **your** window (with an activity flag `!` on its tab until it's checked)
- so a streaming tool is just:

```js
var n = 0;
var id = setInterval(function () {
  print("tick " + (++n));
  if (n >= 10) { clearInterval(id); print("done."); }
}, 1000);
```

- **never busy-wait** — the UI is the browser tab; block it and you freeze the user's terminal
- keep a handle to your interval/timeout and offer a `stop` (see `music stop`, `snake stop`) — a tool that can't be stopped is a bug
- key capture (games like `snake`): capture keys only while your tool is active, and release them on stop/death — otherwise the user's typing dies

## 8. the filesystem & binary data

**the fs holds text.** `data` is a JavaScript string, JSON-serialized into sessionStorage — arbitrary binary bytes do not survive the round-trip (they become `�`).

rules of the road:

- strings only: `fs[p] = { type: "file", data: "hello\n" }`, then `saveState()`
- know your size budget: the whole session lives in sessionStorage (~5–10 MB cap). refuse politely when a write won't fit; don't try to park megabytes in `fs`
- **binary never goes in `fs`** — take it straight to the device with `downloadBytes()` (files), or stream it with an object URL into a hidden `<audio>`/`<video>` (`music`, `vid` patterns)
- bucket round-trip (`save up` / `save down`) is text too — same rules
- your tool's own file is in the fs at `/usr/bin/<name>.slux` — `cat` it if you're curious

## 9. lifecycle, storage & uninstall

| stage | what happens |
|---|---|
| `download <name>` | header parsed → bash section runs → code eval'd → `register()` → file stored at `/usr/bin/<name>.slux` |
| refresh | the session reloads: installed `.slux` files are **re-evaluated automatically**, your command comes back |
| `download rm <name>` | your `CMDS` entry is deleted and the file removed — a clean uninstall |
| purge (tab closes) | everything dies: files, packages, your tool. by design |
| `exps` / `imps` | tools travel with exported sessions — `/usr/bin/*.slux` is part of the archive |

version discipline: bump `#slux version` when you change anything — installs land fresh copies, and `download list` (which reads the GitHub API) shows what's on the branch.

## 10. annotated example

a complete, publishable tool: `mx` — mail-exchanger lookup over DNS-over-HTTPS, with flags, formatting, async output, and a side-effect install line.

```
#slux name mx
#slux desc "mail exchanger lookup via dns-over-HTTPS"
#slux version 1.0.0

mkdir -p /usr/bin
echo "mx <host> — lists MX records. -s sorts by preference, -h help." > /usr/bin/mx.README.txt

#slux code
register("mx", function (args) {
  var usage = "Usage: mx [-s] <host>   — MX records via dns.google (DoH). -s sorts by preference";
  if (!args.length || args[0] === "-h") return print(usage);

  var sort = false, host = null;
  for (var i = 0; i < args.length; i++) {
    if (args[i] === "-s") sort = true;
    else if (args[i].charAt(0) === "-") return err("mx: unknown option '" + args[i] + "'");
    else host = args[i];
  }
  if (!host) return err("mx: need a host");

  print("looking up MX for " + host + " ...");

  fetch("https://dns.google/resolve?name=" + encodeURIComponent(host) + "&type=MX")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var ans = (d && d.Answer || []).filter(function (a) { return a.type === 15; });
      if (!ans.length) return print("mx: no MX records for " + host);

      var rows = ans.map(function (a) {
        var parts = String(a.data).split(" ");
        return { pri: parseInt(parts[0], 10), ex: parts.slice(1).join(" ") };
      });
      if (sort) rows.sort(function (x, y) { return x.pri - y.pri; });

      printHtml(host + "&nbsp;&nbsp;mail is handled by:<br>");
      for (var k = 0; k < rows.length; k++)
        print(("    " + rows[k].pri).slice(-5) + " " + rows[k].ex);
    })
    .catch(function () { err("mx: dns is unreachable — try again when the tab feels like it"); });
});
```

why it's shaped this way:

- usage/errors first, `return` early — nothing runs half-configured
- one `fetch`, output inside `.then` — callbacks auto-route to this window (§7)
- `print` for text, `printHtml` only where you need the break, and even then no dynamic content interpolated unescaped (if `host` ever landed in html it would go through `esc()` first)
- the bash section is idempotent and adds a discoverable README file

## 11. security model

a `.slux` is **your code, running in the user's browser, with their session in scope** — their files, history, and bucket access. that's the point (it's how tools do real work) and the risk.

- installing from the **official `tools` branch**: silent — the user trusts the branch's committers
- installing from **anywhere else** (another repo, a raw link): the sim shows a written warning and a native `confirm()` — cancel aborts the whole install
- therefore: **don't fetch and eval remote code from inside your tool**, don't exfiltrate `fs` or history, don't auto-`register` commands the user didn't ask for
- your tool's network calls are normal CORS `fetch` — the browser enforces origin rules; there is no privileged network
- keep secrets out of `.slux` files: they're public on GitHub. if your tool needs infrastructure, discover it at runtime (see the worker's `/api/config` pattern)

when reviewing someone else's tool, the whole file is the audit: a bash section and a `register()` — no hidden layers.

## 12. testing your tool

**headless (fast, offline)** — the suites in `tests/` boot the real app in jsdom. the pattern (from `tests/lunix-smoke9.js`):

```js
const fs = require("fs");
const { JSDOM } = require("jsdom");
const html = fs.readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8");
const slux = fs.readFileSync(require("path").join(__dirname, "..", "tools", "mx.slux"), "utf8");

// boot the sim with fetch mocked (serve your .slux + canned DNS answers)
// submit "download mx" — the real installer parses, runs bash, evals, registers
// submit "mx example.com -s" — assert on the terminal's textContent
```

two good assertions: your command installs without an eval error, and its output is right (mock `fetch` — tests must not need the network).

**live** — push to the `tools` branch, open the site, `download mx`. or run `npm run preview` locally and `download http://localhost:8787/tools/mx.slux` (you'll get the untrusted confirm — expected, you're off the official branch).

**node-side lint** — `make slux-check` parses every `tools/*.slux` with the same rules as the installer (see [README.md](README.md)).

## 13. publishing

1. write `<name>.slux` — filename == `#slux name`
2. test it (§12)
3. switch to the **`tools` branch** → *Add file → Upload files* → drop the file in → commit. (base project files — `index.html`, `worker/`, `README.md` — live on `main`; the `tools` branch holds **only** tool files, plus `assets/` served on demand)
4. verify: on the site, `download list` (reads the branch via the GitHub API), then `download <name>`
5. iterate: edit → re-upload → `download <name>` again (installs are idempotent — re-runs bash, re-registers, replaces the stored file)

etiquette:

- one tool per file, named exactly `<name>.slux`
- bump `#slux version` on every change
- keep `desc` honest — it's what people read in `gitshop` and `download list`
- uninstall-clean: everything you write into `fs` should be things `download rm` + the purge can lose without breaking the sim

## 14. gotchas checklist

before you upload, walk this list:

- [ ] filename equals `#slux name`
- [ ] `#slux version` bumped if this is an update
- [ ] `-h` prints usage; unknown flags error instead of being ignored
- [ ] bash section idempotent (`mkdir -p`, no bare `mkdir`, safe to run twice)
- [ ] `print` for text / `printHtml` + `esc()` for html — never raw interpolation
- [ ] `saveState()` called after hand-editing `fs`; nothing big stored (sessionStorage budget)
- [ ] no binary data written into `fs` — device files go through `downloadBytes()`
- [ ] async callbacks use `print` (auto-routed to your window); intervals cleared; a `stop` exists
- [ ] no `require`/`import`/node APIs — browser only
- [ ] no secrets, no remote code fetch, no exfiltration (§11)
- [ ] eval errors impossible (a throw fails the install, bash side effects remain)
- [ ] tested headless or live before upload
