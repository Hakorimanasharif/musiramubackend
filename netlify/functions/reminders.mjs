// Scheduled functions have a short deadline. Dispatch the batch to a background function.
export const handler = async () => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !process.env.URL) throw new Error("URL and CRON_SECRET are required for scheduled reminders");
  const response = await fetch(`${process.env.URL}/.netlify/functions/reminders-background`, {
    method: "POST",
    headers: { "x-cron-secret": secret },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Reminder dispatch failed: ${response.status}`);
  return { statusCode: 200 };
};
