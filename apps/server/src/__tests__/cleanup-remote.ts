/**
 * Quick script to clean up stale test data from the remote CalDAV server.
 * Run with: npx tsx src/__tests__/cleanup-remote.ts
 */
import {
  ensureAuthenticated,
  davClient,
  fetchCalendarObjectsDirect,
  currentConfig,
} from "../caldav.js";

async function cleanup() {
  console.log(
    `Connecting to ${currentConfig.url} as ${currentConfig.username}...`,
  );
  await ensureAuthenticated();
  const cals = await davClient.fetchCalendars();
  console.log(`Found ${cals.length} calendars`);

  for (const cal of cals) {
    const calUrl = (cal as any).url;
    console.log(`\nCalendar: ${cal.displayName || calUrl}`);

    const events = await fetchCalendarObjectsDirect(calUrl);
    console.log(`  Events found: ${events.length}`);

    let deleted = 0;
    for (const event of events) {
      if (
        event.url.includes("e2e-") ||
        event.url.includes("task-") ||
        event.url.includes("e2e-test-")
      ) {
        try {
          await davClient.deleteCalendarObject({ calendarObject: event });
          deleted++;
          console.log(`  Deleted: ${event.url.split("/").pop()}`);
        } catch (err) {
          console.warn(`  Failed to delete ${event.url}:`, err);
        }
      }
    }
    console.log(`  Deleted ${deleted} test events`);
  }

  console.log("\nCleanup complete!");
}

cleanup().catch(console.error);
