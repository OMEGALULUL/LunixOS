# LUNIX tools branch

This branch is the package repository for [LUNIX](https://lunix.blueberryservices.co.za) — a simulated linux that lives entirely in your browser. Each tool is a single `.slux` file. Upload a file here and anyone can install it from inside LUNIX with:

```
download <name>          # e.g. download nmap
download list            # list what's on this branch
download rm <name>       # uninstall
```

Tools are installed into the sim's virtual memory (`/usr/bin/<name>.slux`) — they survive a refresh but the purge (closing the tab) wipes them. Re-downloading recreates everything.

---

## the .slux format

A `.slux` file has three parts:

```slux
#slux name nmap
#slux desc "network exploration tool and security / port scanner"
#slux version 1.0.0

# bash section — ordinary LUNIX bash, executed on install
mkdir -p /usr/bin
echo "a note" > /usr/bin/nmap.README.txt

#slux code
register("nmap", function (args) {
  print("Nmap scan report for " + (args[0] || "you"));
});
```

1. **meta header** — `#slux name`, `#slux desc`, `#slux version` (the name must match the filename)
2. **bash section** — any LUNIX command, run on install. Use it to create files, directories, install apk dependencies, etc. Runs between the `#slux` header and the `#slux code` line.
3. **code section** — a JS function registered with `register("<name>", function (args) {...})`.

## what the code section has access to

The code runs with the sim's globals in scope:

| global | what it is |
|---|---|
| `print(s)` | print a line |
| `err(s)` | print an error line |
| `printHtml(html)` | print raw html (use `esc()` for untrusted text) |
| `esc(s)` | html-escape a string |
| `fs` | the virtual filesystem (`fs["/path"] = {type:"file", data:"..."}`) |
| `cwd` | current working directory |
| `norm`, `resolve`, `parent`, `leaf` | path helpers |
| `CMDS` | the command map |
| `pkgs` | installed apk packages |

`args` is the array of arguments after the command name (quotes already stripped). `&&` and `> file` redirection work on install lines too.

## how to add a tool

1. write `<name>.slux` (see `nmap.slux` for a full example)
2. switch to the `tools` branch → **Add file → Upload files** → drop in the `.slux`
3. commit — done. test it: `download list`, then `download <name>`.

Keep one file per tool, named exactly `<name>.slux`. Base files (`index.html`, `worker/`, this project's README) live on `main` — this branch holds **only** tools.

## available tools

| tool | desc |
|---|---|
| `nmap` | network exploration / port scanner — `nmap -sV -p 22,80,443 <host>`, `-sn`, `-O`, `-A`, `-oN <file>`, `--help` |

## tips

- use `mkdir -p` instead of `mkdir` in install lines — it never errors on existing dirs
- keep the code section deterministic where it matters (the sim has no real network except DNS/HTTPS the browser allows)
- if a tool needs real DNS or live data, `fetch()` works against any CORS-open public API (e.g. `https://dns.google/resolve?name=...`)
- bump `#slux version` when you change a tool so re-downloads are obvious
