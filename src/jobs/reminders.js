import Loan from "../models/Loan.js";
import ShopProfile from "../models/ShopProfile.js";
import { notifyShopOwner } from "../utils/shopNotifier.js";

const ONE_DAY = 24 * 60 * 60 * 1000;

/**
 * Daily reminder job — overdue (every day) + upcoming (3 days before) + ntabwiko (daily).
 * Only marks lastOverdueNotifiedAt/lastReminderAt when SMS actually succeeded
 * (or simulated when no provider key), so a failed send retries on next tick
 * instead of being silently skipped for 24h.
 *
 * @param {{ force?: boolean }} opts - force=true ignores 24h cutoff (manual "send today" trigger)
 */
export const runReminderJob = async ({ force = false } = {}) => {
  const startedAt = new Date();
  const result = {
    startedAt,
    force,
    markedOverdue: 0,
    overdue: { checked: 0, sent: 0, failed: 0, skippedDisabled: 0, details: [] },
    upcoming: { checked: 0, sent: 0, failed: 0, skippedDisabled: 0, details: [] },
    ntabwiko: { checked: 0, sent: 0, failed: 0, skippedDisabled: 0, details: [] },
  };

  const now = new Date();
  const cutoff = new Date(Date.now() - ONE_DAY);

  // 0) Auto-mark past-due Pending loans as Overdue
  const markRes = await Loan.updateMany(
    { dueDate: { $lt: now }, remaining: { $gt: 0 }, status: "Pending" },
    { $set: { status: "Overdue" } }
  );
  result.markedOverdue = markRes.modifiedCount || 0;
  if (result.markedOverdue) console.log(`⏰ Overdue marker: ${result.markedOverdue} loans -> Overdue`);

  const timeFilter = force ? {} : { $or: [{ lastOverdueNotifiedAt: null }, { lastOverdueNotifiedAt: { $lt: cutoff } }] };
  const reminderFilter = force ? {} : { $or: [{ lastReminderAt: null }, { lastReminderAt: { $lt: cutoff } }] };
  const limit = force ? 50 : 20;

  // 1) Overdue: remind EVERY DAY
  const overdue = await Loan.find({
    status: "Overdue",
    remaining: { $gt: 0 },
    ...timeFilter,
  }).populate("customer").limit(limit);
  result.overdue.checked = overdue.length;
  if (!overdue.length) console.log(`📭 Overdue check: 0 due (force=${force})`);
  for (const loan of overdue) {
    const shop = await ShopProfile.findOne();
    if (shop?.notifications && shop.notifications.smsOnOverdue === false) {
      result.overdue.skippedDisabled++;
      result.overdue.details.push({ loanId: loan.loanId, status: "skipped-disabled" });
      console.log(`⏭️ Overdue ${loan.loanId} skipped — smsOnOverdue disabled in ShopProfile`);
      continue;
    }
    try {
      const daysOverdue = Math.ceil((Date.now() - new Date(loan.dueDate)) / ONE_DAY);
      const notifyRes = await notifyShopOwner({
        type: "overdue",
        customerName: loan.customer ? `${loan.customer.firstName} ${loan.customer.lastName}` : "Customer",
        amount: loan.remaining,
        loanId: loan.loanId,
        loanDbId: loan._id,
        customerId: loan.customer?._id || loan.customer,
        ownerId: loan.createdBy,
        details: `Daily reminder — Overdue ${daysOverdue} day(s), Remaining: ${loan.remaining} RWF. Due was ${new Date(loan.dueDate).toISOString().slice(0, 10)}`,
      });
      if (notifyRes?.smsSuccess) {
        loan.lastOverdueNotifiedAt = new Date();
        loan.lastReminderAt = new Date();
        await loan.save();
        result.overdue.sent++;
        result.overdue.details.push({ loanId: loan.loanId, status: "sent", to: loan.customer?.phone });
        console.log(`📱 Daily overdue reminder SENT for ${loan.loanId} to ${loan.customer?.phone}`);
      } else {
        result.overdue.failed++;
        const err = notifyRes ? "sms provider failed (see SmsLog + server logs)" : "notifyShopOwner threw (see server logs)";
        result.overdue.details.push({ loanId: loan.loanId, status: "failed", error: err });
        console.warn(`⚠️ Daily overdue SMS FAILED for ${loan.loanId} — will retry next tick. ${err}`);
      }
    } catch (e) {
      result.overdue.failed++;
      result.overdue.details.push({ loanId: loan.loanId, status: "failed", error: e.message });
      console.warn("daily overdue SMS failed", loan.loanId, e.message);
    }
  }

  // 2) Upcoming due: remind 3 days before dueDate (Pending loans)
  const threeDaysFromNow = new Date(Date.now() + 3 * ONE_DAY);
  const upcoming = await Loan.find({
    status: "Pending",
    remaining: { $gt: 0 },
    dueDate: { $gte: now, $lte: threeDaysFromNow },
    ...reminderFilter,
  }).populate("customer").limit(limit);
  result.upcoming.checked = upcoming.length;
  for (const loan of upcoming) {
    const shop = await ShopProfile.findOne();
    if (shop?.notifications && shop.notifications.smsOnOverdue === false) {
      result.upcoming.skippedDisabled++;
      continue;
    }
    try {
      const daysLeft = Math.ceil((new Date(loan.dueDate) - now) / ONE_DAY);
      const notifyRes = await notifyShopOwner({
        type: "reminder",
        customerName: loan.customer ? `${loan.customer.firstName} ${loan.customer.lastName}` : "Customer",
        amount: loan.remaining,
        loanId: loan.loanId,
        loanDbId: loan._id,
        customerId: loan.customer?._id || loan.customer,
        ownerId: loan.createdBy,
        details: `Daily reminder — Due in ${daysLeft} day(s) on ${new Date(loan.dueDate).toISOString().slice(0, 10)}, Remaining: ${loan.remaining} RWF.`,
      });
      if (notifyRes?.smsSuccess) {
        loan.lastReminderAt = new Date();
        await loan.save();
        result.upcoming.sent++;
        console.log(`📱 Daily upcoming reminder SENT for ${loan.loanId} to ${loan.customer?.phone}`);
      } else {
        result.upcoming.failed++;
        result.upcoming.details.push({ loanId: loan.loanId, status: "failed" });
        console.warn(`⚠️ Daily upcoming SMS FAILED for ${loan.loanId} — will retry next tick`);
      }
    } catch (e) {
      result.upcoming.failed++;
      console.warn("daily upcoming SMS failed", loan.loanId, e.message);
    }
  }

  // 3) Ntabwiko loans (dueDateUnknown=true): daily reminders from Day 1
  const ntabwiko = await Loan.find({
    dueDateUnknown: true,
    status: "Pending",
    remaining: { $gt: 0 },
    ...reminderFilter,
  }).populate("customer").limit(limit);
  result.ntabwiko.checked = ntabwiko.length;
  for (const loan of ntabwiko) {
    const shop = await ShopProfile.findOne();
    if (shop?.notifications && shop.notifications.smsOnOverdue === false) {
      result.ntabwiko.skippedDisabled++;
      continue;
    }
    try {
      const daysSinceCreated = Math.ceil((Date.now() - new Date(loan.createdAt)) / ONE_DAY);
      const notifyRes = await notifyShopOwner({
        type: "reminder",
        customerName: loan.customer ? `${loan.customer.firstName} ${loan.customer.lastName}` : "Customer",
        amount: loan.remaining,
        loanId: loan.loanId,
        loanDbId: loan._id,
        customerId: loan.customer?._id || loan.customer,
        ownerId: loan.createdBy,
        details: `Ntabwiko daily reminder — Day ${daysSinceCreated} since loan created, Remaining: ${loan.remaining} RWF.`,
      });
      if (notifyRes?.smsSuccess) {
        loan.lastReminderAt = new Date();
        await loan.save();
        result.ntabwiko.sent++;
        console.log(`📱 Ntabwiko daily reminder SENT for ${loan.loanId} (Day ${daysSinceCreated})`);
      } else {
        result.ntabwiko.failed++;
        console.warn(`⚠️ Ntabwiko SMS FAILED for ${loan.loanId} — will retry next tick`);
      }
    } catch (e) {
      result.ntabwiko.failed++;
      console.warn("ntabwiko daily SMS failed", loan.loanId, e.message);
    }
  }

  result.finishedAt = new Date();
  console.log(
    `✅ Reminder job done (force=${force}): marked=${result.markedOverdue} overdue checked=${result.overdue.checked} sent=${result.overdue.sent} failed=${result.overdue.failed} | upcoming sent=${result.upcoming.sent} | ntabwiko sent=${result.ntabwiko.sent}`
  );
  return result;
};

export default runReminderJob;
