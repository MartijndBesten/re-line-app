// Test-mailserver voor de geautomatiseerde test van de inloglink: ontvangt mail via SMTP (zonder TLS, alleen 127.0.0.1)
// en toont ontvangen berichten via HTTP (GET /berichten, DELETE /berichten). Alleen fictieve adressen.
//   node scripts/mock-smtp.mjs 2526 3114
import { createServer as tcp } from "node:net";
import { createServer as http } from "node:http";
const [smtpPort, httpPort] = [Number(process.argv[2] ?? 2526), Number(process.argv[3] ?? 3114)];
let messages = [];
const qp = (s) => s.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
function parse(raw, rcpt) {
  const [head, ...rest] = raw.split("\r\n\r\n");
  const headers = Object.fromEntries(
    head.replace(/\r\n[ \t]+/g, " ").split("\r\n").map((l) => [l.slice(0, l.indexOf(":")).toLowerCase(), l.slice(l.indexOf(":") + 1).trim()]),
  );
  let body = rest.join("\r\n\r\n").replace(/^\.\./gm, ".");
  const enc = (headers["content-transfer-encoding"] ?? "").toLowerCase();
  if (enc === "quoted-printable") body = Buffer.from(qp(body), "latin1").toString("utf8");
  else if (enc === "base64") body = Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  return { to: rcpt, from: headers.from, subject: headers.subject, text: body };
}
tcp((sock) => {
  let buf = "", data = false, rcpt = [];
  const say = (l) => sock.write(l + "\r\n");
  say("220 mock-smtp ESMTP");
  sock.on("data", (chunk) => {
    buf += chunk.toString("latin1");
    for (;;) {
      if (data) {
        const end = buf.indexOf("\r\n.\r\n");
        if (end < 0) return;
        messages.push(parse(buf.slice(0, end), rcpt));
        buf = buf.slice(end + 5);
        data = false;
        rcpt = [];
        say("250 OK opgeslagen");
        continue;
      }
      const nl = buf.indexOf("\r\n");
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === "EHLO" || cmd === "HELO") sock.write("250-mock-smtp\r\n250 8BITMIME\r\n");
      else if (cmd === "MAIL" || cmd === "RSET" || cmd === "NOOP") say("250 OK");
      else if (cmd === "RCPT") (rcpt.push(line.replace(/^RCPT TO:\s*<?([^>]*)>?.*$/i, "$1").toLowerCase()), say("250 OK"));
      else if (cmd === "DATA") (data = true, say("354 einde met <CRLF>.<CRLF>"));
      else if (cmd === "QUIT") (say("221 tot ziens"), sock.end());
      else say("502 niet ondersteund");
    }
  });
  sock.on("error", () => {});
}).listen(smtpPort, "127.0.0.1");
http((req, res) => {
  if (req.method === "DELETE") messages = [];
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(messages));
}).listen(httpPort, "127.0.0.1", () => console.log(`Test-mailserver: SMTP ${smtpPort}, berichten via http://127.0.0.1:${httpPort}/berichten`));
