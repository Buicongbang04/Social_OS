import { describe, expect, it } from "vitest";
import { RuntimeError } from "../errors/taxonomy";
import { isValidSchedule, nextRunAfter, nextRunAfterFiring } from "./cron";

const VN = { cron: "0 8 * * *", timezone: "Asia/Ho_Chi_Minh" };

describe("cron schedules", () => {
  it("resolves a local time to the right instant", () => {
    // 08:00 in Asia/Ho_Chi_Minh is 01:00 UTC. Getting this wrong posts at the
    // wrong time of day for every user outside UTC, which is most of them.
    const next = nextRunAfter(VN, new Date("2026-07-27T00:00:00Z"));

    expect(next.toISOString()).toBe("2026-07-27T01:00:00.000Z");
  });

  it("moves to tomorrow once today's occurrence has passed", () => {
    const next = nextRunAfter(VN, new Date("2026-07-27T02:00:00Z"));

    expect(next.toISOString()).toBe("2026-07-28T01:00:00.000Z");
  });

  it("is strictly after the given moment, never equal to it", () => {
    // Returning the same instant would make a firing immediately due again,
    // and the scheduler would fire it in a tight loop.
    const at = new Date("2026-07-27T01:00:00Z");

    expect(nextRunAfter(VN, at).getTime()).toBeGreaterThan(at.getTime());
  });

  it("keeps the local hour across a daylight-saving change", () => {
    // "Every morning at 8" means 8am local on both sides of the change. A
    // schedule resolved once against a fixed offset drifts by an hour.
    const madrid = { cron: "0 8 * * *", timezone: "Europe/Madrid" };

    const winter = nextRunAfter(madrid, new Date("2026-01-15T00:00:00Z"));
    const summer = nextRunAfter(madrid, new Date("2026-07-15T00:00:00Z"));

    expect(winter.toISOString()).toBe("2026-01-15T07:00:00.000Z");
    expect(summer.toISOString()).toBe("2026-07-15T06:00:00.000Z");
  });

  it("skips the occurrences an outage missed rather than owing them", () => {
    // Down for three days on a daily schedule: firing the three missed runs
    // back to back would publish three days of posts in one minute. The next
    // run is measured from now, not from what was missed.
    const backOnline = new Date("2026-07-30T09:00:00Z");

    const next = nextRunAfterFiring(VN, backOnline);

    expect(next.toISOString()).toBe("2026-07-31T01:00:00.000Z");
  });

  it("rejects an expression that cannot be parsed", () => {
    expect(() =>
      nextRunAfter({ cron: "không phải cron", timezone: "UTC" }, new Date()),
    ).toThrow(RuntimeError);
  });

  it("rejects a timezone that does not exist", () => {
    // Silently falling back to UTC would run at the wrong hour without ever
    // saying so.
    expect(() =>
      nextRunAfter({ cron: "0 8 * * *", timezone: "Mars/Olympus" }, new Date()),
    ).toThrow(RuntimeError);
  });

  it("classifies a bad schedule as VALIDATION, so nothing retries it", () => {
    const error = (() => {
      try {
        nextRunAfter({ cron: "bad", timezone: "UTC" }, new Date());
      } catch (caught) {
        return caught as RuntimeError;
      }
      return null;
    })();

    expect(error?.errorClass).toBe("VALIDATION");
    expect(error?.retryable).toBe(false);
  });

  it("reports validity without throwing, for callers that only need a check", () => {
    expect(isValidSchedule(VN)).toBe(true);
    expect(isValidSchedule({ cron: "bad", timezone: "UTC" })).toBe(false);
    expect(isValidSchedule({ cron: "0 8 * * *", timezone: "Nope/Nope" })).toBe(
      false,
    );
  });

  it("handles a schedule finer than daily", () => {
    const hourly = { cron: "0 * * * *", timezone: "UTC" };

    expect(
      nextRunAfter(hourly, new Date("2026-07-27T10:30:00Z")).toISOString(),
    ).toBe("2026-07-27T11:00:00.000Z");
  });
});
