const cron = require("node-cron");
const moment = require("moment-timezone");
const { fetchGoogleEvents, saveEventsBatch } = require("../service/events");

cron.schedule("35 23 * * *", async () => {
  const now = moment().tz("America/New_York");

  if (now.hour() === 0) {
    console.log(`Running Vibesy event sync @ ${now.format()}`);

    const events = await fetchGoogleEvents();
    if (events.length === 0) {
      console.warn("No events found to save.");
      return;
    }

    await saveEventsBatch(events);
    console.log("Events synced via scheduled cron job.");
  }
}, {
  timezone: "America/New_York",
});