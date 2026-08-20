# LUNIX

![LUNIX](LUNIX.jpg)

a simulated linux, living entirely in your browser. everything you install dies when the tab closes. no cookies, no disk, no judgement.

**live at:** https://lunix.blueberryservices.co.za

---

## table of contents

1. [what it is](#what-it-is)
2. [architecture](#architecture)
3. [the terminal](#the-terminal)
4. [planned commands — being built into the platform](#planned-commands--being-built-into-the-platform)
5. [storage — the r2 bucket](#storage--the-r2-bucket)
6. [session lifecycle & the purge](#session-lifecycle--the-purge)
7. [project layout](#project-layout)
8. [run it from scratch](#run-it-from-scratch)
   - [local — zero setup](#local--zero-setup)
   - [github pages](#github-pages)
   - [cloudflare worker + r2 + domain](#cloudflare-worker--r2--domain)
9. [the worker api](#the-worker-api)
10. [customizing](#customizing)
11. [why simulated, not a real vm](#why-simulated-not-a-real-vm)

---

## what it is

LUNIX is a fully self-contained, dependency-free browser terminal that simulates a CLI linux install 1:1:

- systemd-style boot sequence (figlet banner, `[    0.000000] [  OK  ]` log lines)
- `lunix login:` → `Last login:` → `/etc/motd` → bash prompt
- prompt is a real install's prompt: `user@lunix:~/path$` (green user, blue path, `#` as root)
- a working virtual filesystem (`ls -l`, `cd`, `cat`, `mkdir`, `touch`, `rm`, `mv`, `cp`, `tree`)
- a simulated `apk` package manager with a 21-package index
- installed tools light up: `cowsay`, `python3`, `git`, `node`, `htop`, `lolcat`, `docker`, `ssh`, `tmux`, `nginx`...
- `ping`, `curl`, `wget`, `sudo`, `su`, `history`, `&&` chaining, arrow-up history
- `reboot`, `poweroff`, `end`, `logout`, `exit`

the aesthetic is the ZTNA portfolio's dark bash theme: `#000` background, `#c9c9c9` text, Ubuntu green `#4e9a06`, blue `#729fcf`, orange accent `#e95420`, Consolas / Cascadia Mono / Ubuntu Mono.

## architecture

```
┌─────────────────────────────┐
│  browser                    │
│  index.html  ← the entire   │
│  app. zero dependencies.    │
│  sessionStorage = the disk  │
└──────────┬──────────────────┘
           │ static files + /api/bucket
┌──────────▼──────────────────┐
│  cloudflare worker (lunix)  │
│  - serves index.html/assets │
│  - /api/bucket* → R2        │
└──────────┬──────────────────┘
┌──────────▼──────────────────┐
│  R2 bucket "lunix" (~10GB)  │
│  - static assets            │
│  - user/ = downloadable     │
│    files (the storage)      │
└─────────────────────────────┘
```

- the app itself needs **no server** — open `index.html` and it runs.
- the worker + R2 add: hosting, the storage API, and the custom domain.

## the terminal

| area | commands |
|---|---|
| files | `ls [-l]`, `cd`, `pwd`, `cat`, `echo`, `mkdir`, `touch`, `rm [-rf]`, `mv`, `cp`, `tree` |
| system | `whoami`, `id`, `uname [-a -r -m]`, `hostname`, `uptime`, `date`, `free`, `history`, `clear` |
| packages | `apk update`, `apk add <pkg...>`, `apk del <pkg>`, `apk search <term>`, `apk info <pkg>` |
| network | `ping <host>`, `curl <url>`, `wget` |
| auth | `sudo`, `su root`, `login` |
| lifecycle | `logout`, `exit`, `reboot`, `poweroff`, `end` |
| tools (after `apk add`) | `cowsay`, `python3`, `git`, `node`, `htop`, `lolcat`, `docker`, `ssh`, `tmux`, `fish`, `zsh`, `bash`, `nginx`, `jq`, `neovim`, `vim`, `ripgrep`, `tree`, `openssh` |

quick start:

```
lunix login: lunix
lunix@lunix:~$ apk add cowsay && cowsay moo
lunix@lunix:~$ apk add lolcat && lolcat hi
lunix@lunix:~$ mkdir tools && cd tools && pwd
lunix@lunix:~$ sudo rm -rf /
lunix@lunix:~$ poweroff      # purges everything
```

## planned commands — being built into the platform

status: `done` · `next` (being worked on now) · `planned`

### storage — the r2 bucket (next)

the sim talks to the bucket through the worker api — see [storage](#storage--the-r2-bucket).

| command | what it does | status |
|---|---|---|
| `save down` | list files in the bucket | next |
| `save down <name>` | download a bucket file into the virtual filesystem | next |
| `save up <file>` | upload a virtual file to the bucket | planned |
| `save rm <name>` | delete a file from the bucket | planned |
| `save du` | show bucket usage | planned |
| `man save` | manual page for the save commands | planned |

### network & security

| command | what it does | status |
|---|---|---|
| `nmap [-sV] [-sn] [-p <ports>] <host>` | scan the sim's internet — the sim answers: host up, the usual ports open | planned |
| `dig <name> [<type>]` | real dns lookups via 1.1.1.1 (DoH), like the portfolio terminal | planned |
| `iptables -L` | show the gate as firewall rules (the mTLS zero-trust story) | planned |
| `connect` | show this session's identity and badge state | planned |
| `ip addr` / `hostname -I` | the sim's network card: 192.168.86.100/24, latency 0ms | planned |
| `ping <host>` | already exists — upgrade to a real latency probe against the live site | planned |

### system

| command | what it does | status |
|---|---|---|
| `man <cmd>` | mini manual pages for every command | planned |
| `top` | process list — one process: `pretending` | planned |
| `env` / `echo $PS1` | real-looking environment output | planned |
| `df` / `du` | disk usage of the virtual filesystem (sessionStorage-backed) | planned |
| `stat` / `file` / `head` / `tail` / `grep` | the coreutils the fs deserves | planned |
| `apt` | easter egg: "this is alpine. it's apk. don't." | planned |

### fun

| command | what it does | status |
|---|---|---|
| `matrix` | the rain, but in the browser | planned |
| `snake` | playable snake in the terminal | planned |
| `sl` | an angry steam locomotive when you misspell `ls` | planned |
| `fortune` | one-liners from the void | planned |
| `figlet <text>` | the banner font, on demand | planned |
| `weather` / `clock` | live weather (wttr.in) and clock | planned |
| `coffee` / `42` / `godmode` / `hack` | the classics | planned |

### terminal features

| feature | what it does | status |
|---|---|---|
| tab completion | complete command names and file paths | planned |
| `history` search | ctrl-r style reverse search | planned |

want a command added? it's a few lines in the `CMDS` map — see [customizing](#customizing).

## storage — the r2 bucket

the 10GB R2 bucket is the sim's external storage. files uploaded under the `user/` prefix are downloadable through the worker api. currently a test file is there: `user/test_download.txt`.

the worker exposes (all behind the `lunix` worker):

| endpoint | purpose |
|---|---|
| `GET /api/bucket` | list downloadable files: `{"files":[{"name","size","modified"}]}` |
| `GET /api/bucket/<name>` | download file bytes (`Content-Disposition: attachment`) |

a download command inside the terminal is the next feature — it will fetch the list, let you pick a file, fetch the bytes, and write them into the virtual filesystem.

notes:
- names are flat (no `/`), path traversal is rejected with 400
- static assets (iso, bios, wasm) live outside `user/` so they never show in the list
- the bucket is currently public-read through the worker — fine for a demo; gate it behind the mTLS badge if you want it locked like `save://`

## session lifecycle & the purge

- the sim's disk is `sessionStorage` (browser memory for this tab)
- **close the tab → everything is gone.** that's the purge, by construction
- refresh keeps your session (nice)
- `poweroff` / `end` → wipes state and reboots
- `reboot` → reboots without wiping
- the tmux bar at the bottom shows uptime, package count, and the session id

## project layout

```
lunix/
├── index.html          ← the entire app. copy this anywhere, it runs.
├── README.md
└── worker/             ← optional cloudflare layer
    ├── index.js        ← worker source (static + /api/bucket + wisp relay)
    └── wrangler.jsonc  ← worker config (R2 binding "LUNIX")
```

## run it from scratch

### local — zero setup

```sh
open index.html        # that's it. works from any browser
```

### github pages

1. create a repo (e.g. `lunix`) and push `index.html` to the root
2. repo → settings → pages → deploy from branch `main` / root
3. it's live at `https://<you>.github.io/lunix`

### cloudflare worker + r2 + domain

prereqs: a cloudflare account + zone, wrangler authenticated (`npx wrangler login`, or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` env vars).

```sh
# 1. create the bucket
npx wrangler r2 bucket create lunix

# 2. upload the app + assets (optional: v86 assets for the real-vm revival)
npx wrangler r2 object put lunix/index.html --file index.html --remote
npx wrangler r2 object put lunix/user/test_download.txt --file test.txt --remote

# 3. deploy the worker
cd worker
npx wrangler deploy
# → https://lunix.<subdomain>.workers.dev

# 4. custom domain (two API calls — replace zone id / hostname / script name)
#    dns:  CNAME lunix → lunix.<subdomain>.workers.dev  (proxied)
#    zone route:  pattern "lunix.<your-zone>/*" → script "lunix"
```

the worker serves:

| path | content |
|---|---|
| `/` | `index.html` from R2 (no-cache) |
| `/v86.js` `/v86.wasm` `/alpine.iso` `/bios/*` | cached immutable assets (real-vm revival) |
| `/api/bucket` | bucket file list |
| `/api/bucket/<name>` | bucket file download |
| `/wisp` | websocket relay (real-vm revival, needs workers paid) |

## the worker api

**list**

```sh
curl https://lunix.blueberryservices.co.za/api/bucket
# {"files":[{"name":"test_download.txt","size":27,"modified":"2026-08-19T16:15:38.780Z"}]}
```

**download**

```sh
curl -OJ https://lunix.blueberryservices.co.za/api/bucket/test_download.txt
```

## customizing

- **packages**: edit the `PKGS` map in `index.html` (name, size MiB, description)
- **boot log**: edit `BOOT_LINES` (timestamp, message, `ok:` / `fatal:`)
- **motd / os-release**: edit `/etc/motd` and `/etc/os-release` in the `fs` map
- **theme**: edit the `:root` variables at the top of the `<style>` block
- **commands**: add a key to the `CMDS` map

## why simulated, not a real vm

originally LUNIX was planned as a real v86 VM booting Alpine (270MB ISO, staged in the bucket) with a wisp relay worker for real internet (`apk` installs would be real). outbound TCP sockets (`node:net` connect) turned out to be blocked on the free workers plan — the proxy refuses every handshake ("consider using fetch instead"). per the decision rule ("real vm if it works on cloudflare, otherwise simulate"), the sim shipped and the v86 path was parked:

- the relay worker (`/wisp`, wisp protocol over websocket) is still in `worker/index.js`
- the v86 assets (libv86.js, v86.wasm, seabios, vgabios, alpine ISO) are still in the bucket
- if the account ever moves to **workers paid** (enables tcp sockets), the real vm is a frontend swap + redeploy away

---

LUNIX is a demo/portfolio piece — the point is that the purge is always watching.