import nodemailer from "nodemailer";
/**
 * Verzenden van de inlogmail (RELINE_AUTH=email) via SMTP van een geverifieerde mailprovider.
 *
 *   RELINE_MAIL_SMTP_URL  smtp://gebruiker:wachtwoord@host:587 (STARTTLS verplicht) of smtps://…:465.
 *                         Op hosting die 465/587 blokkeert (bijv. gratis Render) poort 2525 van de provider.
 *   RELINE_MAIL_FROM      afzender, bijv. "Re-Line <noreply@example.nl>" (domein met SPF/DKIM/DMARC).
 *
 * Geheimen staan alleen in de omgeving, nooit in Git. Er wordt niets gelogd over inhoud, ontvanger of link.
 * RELINE_MAIL_INSECURE_TEST=1 staat zonder TLS alléén toe naar 127.0.0.1 (geautomatiseerde test).
 */
export type LoginMail = { to: string; name: string; link: string; minutes: number };
export type MailSender = (m: LoginMail) => Promise<void>;

export function mailConfigured() {
  return !!process.env.RELINE_MAIL_SMTP_URL && !!process.env.RELINE_MAIL_FROM;
}
function transport() {
  const url = new URL(process.env.RELINE_MAIL_SMTP_URL ?? "");
  const local = url.hostname === "127.0.0.1";
  const insecure = process.env.RELINE_MAIL_INSECURE_TEST === "1" && local;
  if (!["smtp:", "smtps:"].includes(url.protocol)) throw Error("RELINE_MAIL_SMTP_URL moet met smtp:// of smtps:// beginnen");
  return nodemailer.createTransport({
    host: url.hostname,
    port: Number(url.port || (url.protocol === "smtps:" ? 465 : 587)),
    secure: url.protocol === "smtps:",
    requireTLS: !insecure && url.protocol === "smtp:",
    ignoreTLS: insecure,
    auth: url.username ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}
export function loginMailText(m: LoginMail) {
  return [
    `Hallo ${m.name},`,
    "",
    `Met deze link meld je je aan bij Re-Line. De link is ${m.minutes} minuten geldig en werkt één keer:`,
    "",
    m.link,
    "",
    "Heb je geen inloglink aangevraagd? Dan kun je deze e-mail negeren; er gebeurt niets.",
    "",
    "Re-Line | Utiliteit — interne toepassing",
  ].join("\n");
}
/** Standaardverzender (SMTP). In tests wordt een eigen verzender meegegeven. */
export const sendLoginMail: MailSender = async (m) => {
  if (!mailConfigured()) throw Error("E-mailverzending is niet ingesteld");
  await transport().sendMail({
    from: process.env.RELINE_MAIL_FROM,
    to: m.to,
    subject: "Je inloglink voor Re-Line",
    text: loginMailText(m),
    headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" },
  });
};
