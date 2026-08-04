import { createTransport, type Transporter } from "nodemailer";

/**
 * One thing that went wrong and somebody should know about.
 *
 * Deliberately not an error object. What reaches an inbox has to make sense to
 * a person who was not looking at a screen when it happened: what was supposed
 * to go out, where, and what the platform said.
 */
export type Alert = {
  /** A short line, used as the subject when there is one alert. */
  title: string;
  /** What went wrong, in the words the platform already produced. */
  reason: string;
  /** Where to go and look. */
  link?: string | null;
};

export type MailerConfig = {
  /** An SMTP URL, e.g. `smtps://user:pass@smtp.gmail.com:465`. */
  url: string;
  from: string;
  /** Everyone who should hear about it. */
  to: string[];
};

/**
 * Sends an email, or says plainly that it cannot.
 *
 * Configured from one SMTP URL rather than five variables, because that is what
 * every provider hands out and splitting it into host/port/user/pass/secure is
 * four more chances to get one of them wrong.
 */
export interface Notifier {
  send(alerts: Alert[]): Promise<void>;
}

/**
 * Read the configuration, or return null.
 *
 * Null rather than throwing: a deployment that has not set up email should run
 * exactly as it did before, without alerts. Half-configured is different and
 * does throw — a `SMTP_URL` with no `ALERT_EMAIL_TO` is somebody who meant to
 * turn this on, and silently not sending would be the worst of both.
 */
export function mailerConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MailerConfig | null {
  const url = env.SMTP_URL?.trim();
  const to = (env.ALERT_EMAIL_TO ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter((address) => address !== "");

  if (!url && to.length === 0) return null;

  if (!url) {
    throw new Error(
      "ALERT_EMAIL_TO đã đặt nhưng thiếu SMTP_URL — sẽ không gửi được gì.",
    );
  }
  if (to.length === 0) {
    throw new Error(
      "SMTP_URL đã đặt nhưng thiếu ALERT_EMAIL_TO — không biết gửi cho ai.",
    );
  }

  return {
    url,
    // Falls back to the first recipient, which every SMTP server accepts and
    // no server rejects for a mismatched envelope.
    from: env.ALERT_EMAIL_FROM?.trim() || to[0]!,
    to,
  };
}

export class EmailNotifier implements Notifier {
  private readonly transport: Transporter;

  constructor(
    private readonly config: MailerConfig,
    transport?: Transporter,
  ) {
    this.transport = transport ?? createTransport(config.url);
  }

  /**
   * One email for the whole batch, not one per alert.
   *
   * A sweep that fails ten posts because a token expired would otherwise send
   * ten emails saying the same thing, and the eleventh time it happens nobody
   * reads any of them.
   */
  async send(alerts: Alert[]): Promise<void> {
    if (alerts.length === 0) return;

    await this.transport.sendMail({
      from: this.config.from,
      to: this.config.to.join(", "),
      subject:
        alerts.length === 1
          ? `[AI Social OS] ${alerts[0]!.title}`
          : `[AI Social OS] ${alerts.length} việc cần xem`,
      text: body(alerts),
    });
  }
}

/**
 * Plain text, not HTML.
 *
 * This is a machine telling a person something went wrong. HTML would add a
 * rendering step, a spam-filter surface and a way for a post's own words —
 * which are somebody's copy, not ours — to become markup in an email.
 */
function body(alerts: Alert[]): string {
  const lines = alerts.flatMap((alert) => [
    alert.title,
    `  ${alert.reason}`,
    ...(alert.link ? [`  ${alert.link}`] : []),
    "",
  ]);

  return [
    ...lines,
    "—",
    "Thư này do AI Social OS gửi tự động khi có việc không chạy được.",
  ].join("\n");
}
