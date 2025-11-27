const { sendDigestEmail } = require("./emailer");

let timerId = null;
let nextRunAt = null;

function resolveScheduleOptions(options = {}) {
  const enabledEnv = process.env.DAILY_DIGEST_ENABLED;
  const hourEnv = process.env.DAILY_DIGEST_HOUR;
  const minuteEnv = process.env.DAILY_DIGEST_MINUTE;

  const enabled = enabledEnv ? enabledEnv !== "false" : true;
  const hour = Number.isFinite(Number(hourEnv))
    ? Number(hourEnv)
    : Number.isFinite(Number(options.hour))
    ? Number(options.hour)
    : 10;
  const minute = Number.isFinite(Number(minuteEnv))
    ? Number(minuteEnv)
    : Number.isFinite(Number(options.minute))
    ? Number(options.minute)
    : 0;

  return {
    enabled,
    hour: Math.min(Math.max(hour, 0), 23),
    minute: Math.min(Math.max(minute, 0), 59),
  };
}

function computeNextRun(hour, minute) {
  const now = new Date();
  const target = new Date(now);
  target.setSeconds(0, 0);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target;
}

async function runDigestAndSchedule(hour, minute) {
  timerId = null;
  try {
    await sendDigestEmail();
    console.log(
      `[notifications] daily digest dispatched at ${new Date().toISOString()}`
    );
  } catch (error) {
    console.error("[notifications] failed to send daily digest:", error);
  } finally {
    scheduleNextRun(hour, minute);
  }
}

function scheduleNextRun(hour, minute) {
  const target = computeNextRun(hour, minute);
  nextRunAt = target;
  const delay = target.getTime() - Date.now();
  timerId = setTimeout(() => runDigestAndSchedule(hour, minute), delay);
}

function startDailyDigestScheduler(options = {}) {
  if (timerId) {
    return;
  }

  const config = resolveScheduleOptions(options);
  if (!config.enabled) {
    console.log("[notifications] daily digest scheduler disabled");
    return;
  }

  scheduleNextRun(config.hour, config.minute);
  console.log(
    `[notifications] daily digest scheduled for ${nextRunAt.toLocaleString()} (hour=${
      config.hour
    }, minute=${config.minute})`
  );
}

function stopDailyDigestScheduler() {
  if (timerId) {
    clearTimeout(timerId);
    timerId = null;
  }
  nextRunAt = null;
}

function getNextScheduledDigest() {
  return nextRunAt;
}

module.exports = {
  startDailyDigestScheduler,
  stopDailyDigestScheduler,
  getNextScheduledDigest,
};
