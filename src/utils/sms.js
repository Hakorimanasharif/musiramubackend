/**
 * SMS Providers - eSMS Africa & SMSConnect Rwanda
 *
 * eSMS Africa:
 *   Docs: https://docs.esmsafrica.io/docs/api-reference/messages
 *   Endpoint: POST https://sms.esmsafrica.io/api/messages/send
 *     Body: { to: "+250788123456", text: "message", sender_id: "MyBrand" }
 *     Header: Authorization: Bearer <ESMS_API_KEY>
 *
 * SMSConnect Rwanda (https://smsconnect.tech):
 *   Docs: https://smsconnect.tech/docs
 *   Endpoint: POST https://smsconnect.tech/api/v1/sms/send
 *     Body: { recipient: "250788123456", message: "text", sender_id: "MyBrand" }
 *     Header: Authorization: Bearer <SMSCONNECT_API_KEY> + X-API-SECRET: <SMSCONNECT_API_SECRET>
 *   If SMSCONNECT_API_KEY set, it is used first. Else fallback to ESMS.
 *   If neither set, simulated mode (console only).
 */

import axios from "axios";
import SmsLog from "../models/SmsLog.js";

const DEFAULT_API_URL = "https://sms.esmsafrica.io/api/messages/send";
const LEGACY_API_URL = "https://api.esmsafrica.io/v1/sms/send";
const SMSCONNECT_DEFAULT_URL = "https://smsconnect.tech/api/v1/sms/send";

// E.164 Rwanda formatter: 07... -> +2507..., 250... -> +250..., etc.
export const formatRwPhone = (phone) => {
  if (!phone) return null;
  let p = String(phone).replace(/[\s\-\(\)]/g, "");
  // handle 9-digit input like 79838890 (without leading 0) or 079838890 (9 chars with 0 - missing digit case)
  // normalize: if 9 chars starting 0 -> treat as typo, convert by stripping 0
  if (/^0\d{8}$/.test(p)) {
    // 079838890 (9 chars) -> +25079838890 - will be 8 digits after 250, but we pad to validate
    p = `+250${p.slice(1)}`;
    // if still not valid length, keep for validation
  } else if (/^0\d{9}$/.test(p)) p = `+250${p.slice(1)}`;
  else if (/^\d{9}$/.test(p)) p = `+250${p}`;
  else if (/^\d{10}$/.test(p) && p.startsWith("250")) p = `+${p}`;
  else if (/^250\d{9}$/.test(p)) p = `+${p}`;
  else if (!p.startsWith("+")) p = `+${p}`;
  // validate E.164: +250 + 9 digits
  if (!/^\+250\d{9}$/.test(p)) {
    // keep as-is for other countries but ensure + prefix
    if (!/^\+\d{8,15}$/.test(p)) return null;
  }
  return p;
};

const sanitizeSenderId = (senderId) => {
  if (!senderId) return "MusiRamu";
  // Sender ID: alphanumeric, 3-11 chars, no spaces (RURA requirement Rwanda)
  let s = String(senderId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 11);
  if (s.length < 3) s = "MusiRamu";
  return s;
};

const isNewApiUrl = (url) => url.includes("/api/messages/send") || url.includes("sms.esmsafrica.io");

const buildPayload = (url, to, text, senderId) => {
  const sender = sanitizeSenderId(senderId);
  if (isNewApiUrl(url)) {
    return { to, text, sender_id: sender };
  }
  // legacy shape
  return { to: to.replace("+", ""), from: sender, message: text };
};

export const sendSMS = async ({ to, message, text, senderId, type = "loan", loan = null, customer = null } = {}) => {
  const finalText = text || message;
  if (!to || !finalText) {
    console.warn("⚠️  sendSMS called without to/text");
    return { simulated: true, error: "missing to/text" };
  }

  const recipients = Array.isArray(to) ? to : [to];
  const formatted = recipients.map(formatRwPhone).filter(Boolean);
  if (formatted.length === 0) {
    console.warn("⚠️  sendSMS no valid recipients from:", recipients);
    return { simulated: true, error: "no valid recipients" };
  }

  // Provider priority: SMSConnect (Rwanda) -> eSMS Africa -> simulated
  const smsConnectKey = process.env.SMSCONNECT_API_KEY;
  const smsConnectSecret = process.env.SMSCONNECT_API_SECRET;
  const esmsKey = process.env.ESMS_API_KEY || process.env.SMS_API_KEY;

  // Try SMSConnect first if configured
  if (smsConnectKey) {
    if (!smsConnectSecret) {
      console.warn("⚠️  SMSConnect: SMSCONNECT_API_SECRET missing — need both key and secret. Check https://smsconnect.tech/docs#authentication");
    }
    const sender = sanitizeSenderId(senderId || process.env.SMSCONNECT_SENDER_ID || process.env.SMS_SENDER_ID || "MusiRamu");
    const apiUrl = process.env.SMSCONNECT_API_URL || SMSCONNECT_DEFAULT_URL;
    console.log(`\n📱 [SMS via SMSConnect axios] To: ${formatted.join(", ")}\nText: ${finalText.slice(0, 160)}${finalText.length > 160 ? "..." : ""}\nSender: ${sender} | URL: ${apiUrl}\n`);
    const results = [];
    let lastError = null;
    for (const recipient of formatted) {
      // SMSConnect expects recipient without + as 2507... per docs
      const recipientClean = recipient.replace(/^\+/, "");
      const body = { recipient: recipientClean, message: finalText, sender_id: sender };
      const headers = {
        Authorization: `Bearer ${smsConnectKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (smsConnectSecret) headers["X-API-SECRET"] = smsConnectSecret;
      try {
        const response = await axios.post(apiUrl, body, { headers, timeout: 15000 });
        const data = response.data;
        console.log(`✅ SMSConnect sent to ${recipient} | ${JSON.stringify(data).slice(0, 350)}`);
        results.push({ to: recipient, success: true, provider: "smsconnect", data });
      } catch (error) {
        const status = error.response?.status;
        const raw = error.response?.data ? JSON.stringify(error.response.data) : error.message;
        console.warn(`⚠️  SMSConnect failed ${status || ""}:`, raw.slice(0, 800));
        results.push({ to: recipient, success: false, provider: "smsconnect", status, error: raw.slice(0, 400), data: error.response?.data });
        lastError = `SMSConnect ${status || "error"}: ${raw.slice(0, 300)}`;
        console.error("SMS failed:", error.response?.data || error.message);
      }
    }
    // Log to SmsLog for delivery reports
    results.forEach(r => {
      SmsLog.create({
        to: r.to,
        message: finalText.slice(0, 500),
        provider: "smsconnect",
        status: r.success ? "sent" : "failed",
        cost: r.data?.data?.cost ?? r.data?.cost ?? 0,
        balance: String(r.data?.data?.balance ?? r.data?.balance ?? ""),
        providerMessageId: String(r.data?.data?.message_id ?? r.data?.message_id ?? r.data?.id ?? ""),
        type, loan, customer,
        error: r.error,
        raw: r.data
      }).catch(()=>{});
    });
    const allOk = results.every((r) => r.success);
    if (allOk) return { success: true, provider: "smsconnect", to: formatted, results, data: results[0]?.data };
    console.log(`📱 [SMSConnect] ${results.filter((r) => r.success).length}/${results.length} sent. Last error: ${lastError}`);
    // if SMSConnect configured but fails, do not fallback to eSMS to avoid double charge — return error
    return { success: false, provider: "smsconnect", to: formatted, results, error: lastError };
  }

  const apiKey = esmsKey;
  const sender = sanitizeSenderId(senderId || process.env.ESMS_SENDER_ID || process.env.SMS_SENDER_ID || "MusiRamu");
  const apiUrl = process.env.ESMS_API_URL || DEFAULT_API_URL;

  console.log(`\n📱 [SMS via eSMS axios] To: ${formatted.join(", ")}\nText: ${finalText.slice(0, 160)}${finalText.length > 160 ? "..." : ""}\nSender: ${sender} | URL: ${apiUrl}\n`);

  if (!apiKey) {
    console.log("📱 [SMS SIMULATED] No SMS API key (SMSCONNECT_API_KEY or ESMS_API_KEY) - logged to console only. Get SMSConnect at https://smsconnect.tech/docs or eSMS at https://auth.esmsafrica.io/register?service=sms");
    formatted.forEach(to => {
      SmsLog.create({ to, message: finalText.slice(0,500), provider: "simulated", status: "simulated", type, loan, customer, raw: { simulated:true } }).catch(()=>{});
    });
    return { simulated: true, to: formatted, message: finalText, sender_id: sender };
  }

  const results = [];
  let lastError = null;

  for (const recipient of formatted) {
    const body = buildPayload(apiUrl, recipient, finalText, sender);
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    try {
      const response = await axios.post(apiUrl, body, { headers, timeout: 15000 });
      const data = response.data;
      console.log(`✅ eSMS sent to ${recipient} | id=${data.id || "n/a"} cost=${data.cost ?? data.route_cost ?? "?"} | ${JSON.stringify(data).slice(0, 250)}`);
      results.push({ to: recipient, success: true, provider: "esms", data });
    } catch (error) {
      const status = error.response?.status;
      const raw = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      let hint = "";
      if (status === 403) hint = " (Sender ID not approved for Rwanda or not found - register at sms.esmsafrica.io Sender IDs)";
      if (status === 422) hint = " (Wallet balance too low - top up at auth.esmsafrica.io)";
      console.warn(`⚠️  eSMS failed to ${recipient} ${status}${hint}:`, raw.slice(0, 600));
      results.push({ to: recipient, success: false, provider: "esms", status, error: raw.slice(0, 300), data: error.response?.data });
      lastError = `eSMS failed ${status}: ${raw.slice(0, 200)}${hint}`;
    }
  }

  // Log eSMS delivery
  results.forEach(r => {
    SmsLog.create({
      to: r.to,
      message: finalText.slice(0,500),
      provider: "esms",
      status: r.success ? "sent" : "failed",
      cost: r.data?.cost ?? r.data?.route_cost ?? 0,
      balance: String(r.data?.balance ?? ""),
      providerMessageId: String(r.data?.id ?? ""),
      type, loan, customer,
      error: r.error,
      raw: r.data
    }).catch(()=>{});
  });
  const allOk = results.every((r) => r.success);
  if (allOk) {
    return { success: true, provider: "esms", to: formatted, results, data: results[0]?.data };
  }
  console.log(`📱 [eSMS] ${results.filter((r) => r.success).length}/${results.length} sent. Last error: ${lastError}`);
  return { success: false, provider: "esms", simulated: false, to: formatted, results, error: lastError };
};

// Helper: Send OTP (uses same endpoint, just formatted text)
export const sendOTP = async ({ to, otp, senderId, purpose = "verification" }) => {
  if (!otp) otp = String(Math.floor(100000 + Math.random() * 900000));
  const text = `Your ${purpose} code is ${otp}. Valid for 5 minutes. Do not share.`;
  const res = await sendSMS({ to, text, senderId });
  return { ...res, otp };
};

// Helper: Check wallet balance (smsconnect or esms) - now via axios
export const getSmsBalance = async () => {
  const smsConnectKey = process.env.SMSCONNECT_API_KEY;
  const smsConnectSecret = process.env.SMSCONNECT_API_SECRET;
  if (smsConnectKey) {
    const url = "https://smsconnect.tech/api/v1/user";
    const headers = { Authorization: `Bearer ${smsConnectKey}`, Accept: "application/json" };
    if (smsConnectSecret) headers["X-API-SECRET"] = smsConnectSecret;
    try {
      const response = await axios.get(url, { headers, timeout: 10000 });
      const data = response.data;
      return { success: true, provider: "smsconnect", data: data.data || data };
    } catch (error) {
      return { success: false, provider: "smsconnect", error: error.response?.data || error.message, status: error.response?.status };
    }
  }
  const apiKey = process.env.ESMS_API_KEY || process.env.SMS_API_KEY;
  if (!apiKey) return { simulated: true, error: "No API key (SMSCONNECT_API_KEY or ESMS_API_KEY)" };
  const url = "https://sms.esmsafrica.io/api/balance";
  try {
    const response = await axios.get(url, { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10000 });
    return { success: true, provider: "esms", data: response.data };
  } catch (error) {
    return { success: false, provider: "esms", error: error.response?.data || error.message, status: error.response?.status };
  }
};

export default sendSMS;
