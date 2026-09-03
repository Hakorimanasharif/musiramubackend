// Test SMSConnect via axios to your testing number 079838890
// Usage: 
// 1) Fill .env with your real SMSCONNECT_API_KEY and SECRET, or export them
// 2) node test-sms.js
//    or with inline env: SMSCONNECT_API_KEY=xxx SMSCONNECT_API_SECRET=yyy node test-sms.js

import dotenv from "dotenv";
dotenv.config();
import { sendSMS, getSmsBalance, formatRwPhone } from "./src/utils/sms.js";

const TEST_NUMBER = "079838890"; // your test number - note: 9 digits, ideally 10 digits like 0798388890 or 078... - check
// If your real number is 0798388900 or 0798388890, change above.
// Formatted preview:
console.log("Env check:", {
  key: process.env.SMSCONNECT_API_KEY ? process.env.SMSCONNECT_API_KEY.slice(0, 6) + "..." : "MISSING",
  secret: process.env.SMSCONNECT_API_SECRET ? "set (" + process.env.SMSCONNECT_API_SECRET.length + " chars)" : "MISSING",
  sender: process.env.SMSCONNECT_SENDER_ID || "MusiRamu (default)",
  url: process.env.SMSCONNECT_API_URL || "https://smsconnect.tech/api/v1/sms/send (default)",
});
console.log(`Test number ${TEST_NUMBER} -> formatted ${formatRwPhone(TEST_NUMBER)} -> recipient ${formatRwPhone(TEST_NUMBER)?.replace(/^\+/, "")}`);
console.log(`Also check 0798388890 (10 digits) -> ${formatRwPhone("0798388890")}`);

async function main() {
  console.log("\n--- Balance check ---");
  const bal = await getSmsBalance();
  console.log(JSON.stringify(bal, null, 2));

  console.log("\n--- Sending test SMS ---");
  const res = await sendSMS({
    to: TEST_NUMBER,
    message: `MusiRamu test - axios working ✅ ${new Date().toLocaleString()} - Sender ${process.env.SMSCONNECT_SENDER_ID || "MusiRamu"}`,
  });
  console.log("\nResult:", JSON.stringify(res, null, 2));
  if (res.simulated) console.log("\n⚠️  SIMULATED - set SMSCONNECT_API_KEY + SECRET in .env or Render env to send real SMS");
  else if (res.success) console.log("\n✅ SMS sent successfully to", TEST_NUMBER);
  else console.log("\n❌ SMS failed - see error above. Check Sender ID approved & wallet balance at https://smsconnect.tech");
}

main();
