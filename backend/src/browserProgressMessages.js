/**
 * Plain-language status lines for older adults — no jargon, no raw URLs.
 * (Templates only; no LLM.)
 */

const RUNNING_ROTATION = [
  "I'm opening the page now…",
  "I'm looking for the button or link you asked about…",
  "Almost done—checking this screen…",
  "Still with you—taking another careful look at this page…",
];

/** @param {number} i */
export function friendlyLineRunning(i) {
  const idx = Math.max(0, Math.floor(i)) % RUNNING_ROTATION.length;
  return RUNNING_ROTATION[idx];
}

/**
 * @param {string} status - BuAgentSessionStatus
 * @param {number} rotationIndex - increases while work is in progress
 */
export function friendlyLineForCloudStatus(status, rotationIndex) {
  switch (status) {
    case "timed_out":
      return "That took longer than expected. You can try again in a moment.";
    case "error":
      return "Something went wrong with this browse step. You can try again or type what you need below.";
    case "idle":
    case "stopped":
      return "Finished.";
    case "created":
      return "I'm getting started with your request…";
    case "running":
    default:
      return friendlyLineRunning(rotationIndex);
  }
}

/**
 * Interval-based updates while the local Python worker runs (no cloud session status).
 * @param {number} tick - 0, 1, 2, … each time we emit another line
 */
export function friendlyLineLocalTick(tick) {
  if (tick === 0) return "I'm opening the page now…";
  return friendlyLineRunning(tick);
}
