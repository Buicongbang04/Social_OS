import { CronExpressionParser } from "cron-parser";
import { RuntimeError } from "../errors/taxonomy";
import type { GoalSchedule } from "../model/goal";

/**
 * When a schedule should next fire, strictly after `from`.
 *
 * Timezone is required rather than defaulted, and is honoured here rather than
 * converted away: "0 8 * * *" in Asia/Ho_Chi_Minh means 8am local across DST
 * boundaries and daylight changes, which is what a person means by "every
 * morning". Resolving it once against a fixed offset would drift.
 */
export function nextRunAfter(schedule: GoalSchedule, from: Date): Date {
  try {
    return CronExpressionParser.parse(schedule.cron, {
      tz: schedule.timezone,
      currentDate: from,
    })
      .next()
      .toDate();
  } catch (error) {
    throw new RuntimeError(
      "VALIDATION",
      `Invalid schedule "${schedule.cron}" in timezone "${schedule.timezone}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      { context: { cron: schedule.cron, timezone: schedule.timezone } },
    );
  }
}

/** True when the expression and zone can actually be scheduled. */
export function isValidSchedule(schedule: GoalSchedule): boolean {
  try {
    nextRunAfter(schedule, new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Where to set the next run after a firing.
 *
 * Measured from *now*, not from the occurrence that was missed. A runtime that
 * was down for three days with a daily schedule would otherwise owe three
 * runs, and firing them back to back would publish three days of posts in one
 * minute — noticeably worse than skipping them. The docs do not cover the
 * outage case; this is our decision, and it favours not surprising the
 * audience of whoever owns the account.
 */
export function nextRunAfterFiring(schedule: GoalSchedule, now: Date): Date {
  return nextRunAfter(schedule, now);
}
