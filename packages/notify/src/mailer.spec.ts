import type { Transporter } from "nodemailer";
import { describe, expect, it, vi } from "vitest";
import { EmailNotifier, mailerConfigFromEnv, type Alert } from "./mailer";

const CONFIG = {
  url: "smtp://user:pass@localhost:1025",
  from: "bot@tiximax.vn",
  to: ["chu@tiximax.vn"],
};

/** A transport that records what it was asked to send. */
const recording = () => {
  const sent: Record<string, unknown>[] = [];
  const transport = {
    sendMail: vi.fn(async (mail: Record<string, unknown>) => {
      sent.push(mail);
      return {};
    }),
  } as unknown as Transporter;
  return { transport, sent };
};

const alert = (overrides: Partial<Alert> = {}): Alert => ({
  title: 'Không đăng được "Mua hộ hàng Nhật"',
  reason: "Token của Trang một đã hết hạn.",
  link: "https://app.local/calendar",
  ...overrides,
});

describe("mailerConfigFromEnv", () => {
  it("returns nothing when email was never set up", () => {
    // A deployment without email runs exactly as before, no alerts.
    expect(mailerConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("refuses a half-configured setup rather than silently not sending", () => {
    // Somebody who set one of the two meant to turn this on. Staying quiet
    // would be the worst of both: no alerts, and no sign that there are none.
    expect(() =>
      mailerConfigFromEnv({ ALERT_EMAIL_TO: "a@b.vn" } as NodeJS.ProcessEnv),
    ).toThrow(/SMTP_URL/);

    expect(() =>
      mailerConfigFromEnv({ SMTP_URL: "smtp://x" } as NodeJS.ProcessEnv),
    ).toThrow(/ALERT_EMAIL_TO/);
  });

  it("takes several recipients from one line", () => {
    const config = mailerConfigFromEnv({
      SMTP_URL: "smtp://x",
      ALERT_EMAIL_TO: "a@b.vn, c@d.vn ,,",
    } as NodeJS.ProcessEnv);

    expect(config?.to).toEqual(["a@b.vn", "c@d.vn"]);
  });

  it("sends from the first recipient when no sender is named", () => {
    // Every SMTP server accepts that, and none rejects it for a mismatched
    // envelope the way a made-up address gets rejected.
    const config = mailerConfigFromEnv({
      SMTP_URL: "smtp://x",
      ALERT_EMAIL_TO: "a@b.vn",
    } as NodeJS.ProcessEnv);

    expect(config?.from).toBe("a@b.vn");
  });
});

describe("EmailNotifier.check", () => {
  it("says the mail server can be reached", async () => {
    const transport = {
      verify: vi.fn(async () => true),
    } as unknown as Transporter;

    expect(await new EmailNotifier(CONFIG, transport).check()).toEqual({
      ok: true,
    });
  });

  it("reports why it cannot, rather than throwing at startup", async () => {
    // Checked at boot so a wrong setting is found then. It must not stop the
    // service starting: a runtime that refuses to run because email is
    // misconfigured publishes nothing at all, which is worse than publishing
    // without alerts.
    const transport = {
      verify: vi.fn(async () => {
        throw new Error("Connection timeout");
      }),
    } as unknown as Transporter;

    expect(await new EmailNotifier(CONFIG, transport).check()).toEqual({
      ok: false,
      reason: "Connection timeout",
    });
  });
});

describe("EmailNotifier", () => {
  it("says what failed and where to look", async () => {
    const { transport, sent } = recording();
    await new EmailNotifier(CONFIG, transport).send([alert()]);

    expect(sent[0]?.subject).toContain("Mua hộ hàng Nhật");
    expect(sent[0]?.text).toContain("Token của Trang một đã hết hạn.");
    expect(sent[0]?.text).toContain("https://app.local/calendar");
  });

  it("sends one email for a batch, not one per failure", async () => {
    // A sweep that fails ten posts on one expired token would otherwise send
    // ten identical emails, and the eleventh time nobody reads any of them.
    const { transport, sent } = recording();
    await new EmailNotifier(CONFIG, transport).send([
      alert({ title: "Bài một" }),
      alert({ title: "Bài hai" }),
      alert({ title: "Bài ba" }),
    ]);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toContain("3 việc cần xem");
    expect(sent[0]?.text).toContain("Bài một");
    expect(sent[0]?.text).toContain("Bài ba");
  });

  it("sends nothing at all when there is nothing to say", async () => {
    // An empty sweep must not produce an email every fifteen seconds.
    const { transport, sent } = recording();
    await new EmailNotifier(CONFIG, transport).send([]);

    expect(sent).toEqual([]);
  });

  it("writes to everyone who should hear about it", async () => {
    const { transport, sent } = recording();
    await new EmailNotifier(
      { ...CONFIG, to: ["a@b.vn", "c@d.vn"] },
      transport,
    ).send([alert()]);

    expect(sent[0]?.to).toBe("a@b.vn, c@d.vn");
  });

  it("sends plain text, so a post's own words cannot become markup", async () => {
    // The copy in an alert is somebody's marketing text, not ours. In HTML a
    // post containing a tag would render as one.
    const { transport, sent } = recording();
    await new EmailNotifier(CONFIG, transport).send([
      alert({ title: "Bài <b>giảm giá</b>" }),
    ]);

    expect(sent[0]?.html).toBeUndefined();
    expect(sent[0]?.text).toContain("<b>giảm giá</b>");
  });

  it("leaves out a link there is none of", async () => {
    const { transport, sent } = recording();
    await new EmailNotifier(CONFIG, transport).send([alert({ link: null })]);

    expect(sent[0]?.text).not.toContain("http");
  });
});
