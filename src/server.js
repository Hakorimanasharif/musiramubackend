import "dotenv/config";
import app from "./app.js";
import connectDB from "./config/db.js";
import cron from "node-cron";
import { runReminderJob } from "./jobs/reminders.js";

await connectDB();
let running = false;
const run = async () => {
  if (running) return;
  running = true;
  try { await runReminderJob(); }
  catch (error) { console.error("Reminder job failed:", error.message); }
  finally { running = false; }
};
run();
setInterval(run, 10 * 60 * 1000);
cron.schedule("0 8 * * *", run, { timezone: "Africa/Kigali" });
const port = Number(process.env.PORT || 5001);
app.listen(port, () => console.log(`CreditLedger API listening on ${port}`));
