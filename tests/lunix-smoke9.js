const fs = require("fs");
const { JSDOM } = require("jsdom");

const base = "/home/linux/Desktop/LunixOS-main";
const html = fs.readFileSync(base + "/index.html", "utf8");
const digSlux = fs.readFileSync(base + "/tools/dig.slux", "utf8");

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
      window.confirm = () => true;
      window.fetch = (url) => {
        const u = String(url);
        if (u.indexOf("raw.githubusercontent.com/OMEGALULUL/LunixOS/tools/dig.slux") !== -1)
          return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(digSlux) });
        if (u.indexOf("dns.google/resolve") !== -1) {
          const q = new URL(u);
          const name = q.searchParams.get("name") || "";
          const type = (q.searchParams.get("type") || "A").toUpperCase();
          if (type === "PTR" && name === "34.216.184.93.in-addr.arpa")
            return Promise.resolve({ json: () => Promise.resolve({
              Status: 0, RD: true, RA: true,
              Question: [{ name: name, type: 12 }],
              Answer: [{ name: name, type: 12, TTL: 3600, data: "example.com" }]
            }) });
          if (name === "example.com" && type === "A")
            return Promise.resolve({ json: () => Promise.resolve({
              Status: 0, RD: true, RA: true,
              Question: [{ name: name, type: 1 }],
              Answer: [{ name: name, type: 1, TTL: 3600, data: "93.184.216.34" }]
            }) });
          if (name === "nxdomain.example")
            return Promise.resolve({ json: () => Promise.resolve({
              Status: 3, RD: true, RA: true,
              Question: [{ name: name, type: 1 }]
            }) });
          return Promise.resolve({ json: () => Promise.resolve({ Status: 0, Question: [{ name: name, type: 1 }], Answer: [] }) });
        }
        return Promise.reject(new Error("offline"));
      };
    },
  });
  const w = dom.window;
  const doc = w.document;
  w.addEventListener("error", () => {});
  const input = doc.getElementById("vt-input");
  const bodyEl = doc.getElementById("vt-body");
  const submit = async (line) => {
    const n = bodyEl.children.length;
    input.value = line;
    input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await sleep(30);
    let s = "";
    for (let i = n + 1; i < bodyEl.children.length; i++) s += bodyEl.children[i].textContent + "\n"; // +1: skip the echoed prompt line
    return s;
  };

  await sleep(280 * 11 + 900); // wait out the boot overlay
  await submit("lunix");        // log in so the prompt accepts commands

  console.log("network card:");
  let o = await submit("ip addr");
  ok("ip addr shows eth0", o.indexOf("eth0") !== -1);
  ok("ip addr shows 192.168.86.100/24", o.indexOf("192.168.86.100/24") !== -1);
  ok("ip addr shows loopback", o.indexOf("lo:") !== -1 && o.indexOf("127.0.0.1/8") !== -1);
  ok("ip addr shows the mac", o.indexOf("02:42:c0:a8:56:64") !== -1);

  o = await submit("ip a");
  ok("ip a is a shorthand for addr", o.indexOf("192.168.86.100/24") !== -1);

  o = await submit("ip -brief addr");
  ok("ip -brief is compact", o.indexOf("UNKNOWN") !== -1 && o.indexOf("UP") !== -1 && o.indexOf("192.168.86.100/24") !== -1);
  ok("ip -brief drops the detail", o.indexOf("qdisc") === -1);

  o = await submit("ip route");
  ok("ip route has a default gw", o.indexOf("default via 192.168.86.1 dev eth0") !== -1);
  ok("ip route has the lan", o.indexOf("192.168.86.0/24 dev eth0") !== -1);

  o = await submit("ip bogus");
  ok("unknown object gets ip's own error", o.indexOf('Object "bogus" is unknown') !== -1);

  o = await submit("hostname");
  ok("hostname still prints lunix", o.indexOf("lunix") !== -1);
  o = await submit("hostname -I");
  ok("hostname -I prints the card", o.trim() === "192.168.86.100");
  o = await submit("hostname -x");
  ok("hostname rejects a bad flag", o.indexOf("invalid option") !== -1);

  console.log("firewall:");
  o = await submit("iptables -L");
  ok("INPUT defaults to DROP", o.indexOf("Chain INPUT (policy DROP)") !== -1);
  ok("established replies come back in", o.indexOf("ctstate RELATED,ESTABLISHED") !== -1);
  ok("the gate needs mTLS", o.indexOf("mTLS") !== -1);
  ok("forward is sealed", o.indexOf("Chain FORWARD (policy DROP)") !== -1);
  ok("output is free", o.indexOf("Chain OUTPUT (policy ACCEPT)") !== -1);

  o = await submit("iptables -L -n");
  ok("-n speaks in cidr", o.indexOf("0.0.0.0/0") !== -1 && o.indexOf("anywhere") === -1);

  o = await submit("iptables -L -v");
  ok("-v adds byte counters", o.indexOf("pkts") !== -1 && o.indexOf("bytes") !== -1);

  o = await submit("iptables -L INPUT");
  ok("chain arg narrows the listing", o.indexOf("Chain INPUT") !== -1 && o.indexOf("Chain OUTPUT") === -1);

  o = await submit("iptables -L BOGUS");
  ok("bad chain gets iptables' own error", o.indexOf("No chain/target/match by that name") !== -1);

  o = await submit("iptables -S");
  ok("-S prints rules as commands", o.indexOf("-P INPUT DROP") !== -1 && o.indexOf("-A INPUT") !== -1);

  o = await submit("iptables -A INPUT -j ACCEPT");
  ok("the table refuses writes", o.indexOf("read-only") !== -1);

  console.log("dig (tools branch):");
  o = await submit("download dig");
  ok("dig installs from the tools branch", o.indexOf("dig installed into the virtual memory") !== -1);

  o = await submit("dig example.com +short");
  ok("+short is just the answer", o.trim() === "93.184.216.34");

  o = await submit("dig example.com");
  ok("full output has the header", o.indexOf("opcode: QUERY, status: NOERROR") !== -1);
  ok("full output has the question", o.indexOf(";; QUESTION SECTION:") !== -1);
  ok("full output has the answer", o.indexOf(";; ANSWER SECTION:") !== -1 && o.indexOf("93.184.216.34") !== -1);
  ok("full output has stats", o.indexOf(";; Query time:") !== -1 && o.indexOf(";; SERVER: 8.8.8.8#53") !== -1);

  o = await submit("dig -x 93.184.216.34 +short");
  ok("-x does the reverse", o.indexOf("example.com") !== -1);

  o = await submit("dig nxdomain.example");
  ok("nxdomain is reported honestly", o.indexOf("status: NXDOMAIN") !== -1);

  o = await submit("dig --help");
  ok("dig has a help page", o.indexOf("Usage: dig") !== -1);

  o = await submit("help");
  ok("help mentions ip", o.indexOf("ip addr|route") !== -1);
  ok("help mentions iptables", o.indexOf("iptables -L") !== -1);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
