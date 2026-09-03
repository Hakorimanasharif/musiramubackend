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
 *   Endpoint: POST https://api.smsconnect.rw/v1/send
 *     Body: { to: "+250788123456", from: "MyBrand", message: "text" }
 *     Header: Authorization: Bearer <SMSCONNECT_API_KEY>
 *   If SMSCONNECT_API_KEY set, it is used first. Else fallback to ESMS.
 *   If neither set, simulated mode (console only).
 */

const DEFAULT_API_URL = "https://sms.esmsafrica.io/api/messages/send";
const LEGACY_API_URL = "https://api.esmsafrica.io/v1/sms/send";
const SMSCONNECT_DEFAULT_URL = "https://smsconnect.tech/api/v1/sms/send";

// E.164 Rwanda formatter: 07... -> +2507..., 250... -> +250..., etc.
export const formatRwPhone = (phone) => {
  if (!phone) return null;
  let p = String(phone).replace(/[\s\-\(\)]/g, "");
  if (/^0\d{9}$/.test(p)) p = `+250${p.slice(1)}`;
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

export const sendSMS = async ({ to, message, text, senderId } = {}) => {
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

  // Try SMSConnect first if configured (requires both key + secret per docs)
  if (smsConnectKey) {
    if (!smsConnectSecret) {
      console.warn("⚠️  SMSConnect: SMSCONNECT_API_SECRET missing — need both key and secret. Check https://smsconnect.tech/docs#authentication");
    }
    const sender = sanitizeSenderId(senderId || process.env.SMSCONNECT_SENDER_ID || process.env.SMS_SENDER_ID || "MusiRamu");
    const apiUrl = process.env.SMSCONNECT_API_URL || SMSCONNECT_DEFAULT_URL;
    console.log(`\n📱 [SMS via SMSConnect] To: ${formatted.join(", ")}\nText: ${finalText.slice(0, 160)}${finalText.length > 160 ? "..." : ""}\nSender: ${sender} | URL: ${apiUrl}\n`);
    const results = [];
    let lastError = null;
    for (const recipient of formatted) {
      // SMSConnect expects recipient without + as 2507... per docs, but accepts +250 too — strip +
      const recipientClean = recipient.replace(/^\+/, "");
      const body = { recipient: recipientClean, message: finalText, sender_id: sender };
      const headers = { "Authorization": `Bearer ${smsConnectKey}`, "Content-Type": "application/json", "Accept": "application/json" };
      if (smsConnectSecret) headers["X-API-SECRET"] = smsConnectSecret;
      try {
        const res = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify(body) });
        const raw = await res.text();
        let data; try { data = JSON.parse(raw); } catch { data = { raw }; }
        if (res.ok) {
          console.log(`✅ SMSConnect sent to ${recipient} | ${JSON.stringify(data).slice(0, 350)}`);
          results.push({ to: recipient, success: true, provider: "smsconnect", data });
        } else {
          console.warn(`⚠️  SMSConnect failed ${res.status}:`, raw.slice(0, 800));
          results.push({ to: recipient, success: false, provider: "smsconnect", status: res.status, error: raw.slice(0, 400), data });
          lastError = `SMSConnect ${res.status}: ${raw.slice(0, 300)}`;
        }
      } catch (e) {
        console.warn(`⚠️  SMSConnect error to ${recipient}:`, e.message);
        results.push({ to: recipient, success: false, provider: "smsconnect", error: e.message });
        lastError = e.message;
      }
    }
    const allOk = results.every(r=>r.success);
    if (allOk) return { success: true, provider: "smsconnect", to: formatted, results, data: results[0]?.data };
    console.log(`📱 [SMSConnect] ${results.filter(r=>r.success).length}/${results.length} sent. Last error: ${lastError}`);
    // if SMSConnect configured but fails, do not fallback to eSMS to avoid double charge — return error
    return { success: false, provider: "smsconnect", to: formatted, results, error: lastError };
  }

  const apiKey = esmsKey;
  const sender = sanitizeSenderId(senderId || process.env.ESMS_SENDER_ID || process.env.SMS_SENDER_ID || "MusiRamu");
  const apiUrl = process.env.ESMS_API_URL || DEFAULT_API_URL;

  console.log(`\n📱 [SMS via eSMS] To: ${formatted.join(", ")}\nText: ${finalText.slice(0, 160)}${finalText.length > 160 ? "..." : ""}\nSender: ${sender} | URL: ${apiUrl}\n`);

  if (!apiKey) {
    console.log("📱 [SMS SIMULATED] No SMS API key (SMSCONNECT_API_KEY or ESMS_API_KEY) - logged to console only. Get SMSConnect at https://smsconnect.tech/docs or eSMS at https://auth.esmsafrica.io/register?service=sms");
    return { simulated: true, to: formatted, message: finalText, sender_id: sender };
  }

  const results = [];
  let lastError = null;

  // New API requires 1 request per recipient; legacy can batch but we loop for consistency
  for (const recipient of formatted) {
    const body = buildPayload(apiUrl, recipient, finalText, sender);
    const headers = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      let data;
      try { data = JSON.parse(raw); } catch { data = { raw }; }

      if (res.ok) {
        console.log(`✅ eSMS sent to ${recipient} | id=${data.id || "n/a"} cost=${data.cost ?? data.route_cost ?? "?"} | ${JSON.stringify(data).slice(0, 250)}`);
        results.push({ to: recipient, success: true, provider: "esms", data });
      } else {
        // Provide helpful hints for common errors
        let hint = "";
        if (res.status === 403) hint = " (Sender ID not approved for Rwanda or not found - register at sms.esmsafrica.io Sender IDs)";
        if (res.status === 422) hint = " (Wallet balance too low - top up at auth.esmsafrica.io)";
        if (res.status === 400 && data?.detail) hint += ` detail:${data.detail}`;
        console.warn(`⚠️  eSMS failed to ${recipient} ${res.status}${hint}:`, raw.slice(0, 600));
        results.push({ to: recipient, success: false, provider: "esms", status: res.status, error: raw.slice(0, 300), data });
        lastError = `eSMS failed ${res.status}: ${raw.slice(0, 200)}${hint}`;
      }
    } catch (e) {
      console.warn(`⚠️  eSMS fetch error to ${recipient}:`, e.message);
      results.push({ to: recipient, success: false, provider: "esms", error: e.message });
      lastError = e.message;
    }
  }

  const allOk = results.every((r) => r.success);
  if (allOk) {
    return { success: true, provider: "esms", to: formatted, results, data: results[0]?.data };
  }
  // partial or full failure - don't throw, keep business flow alive but return error
  console.log(`📱 [eSMS] ${results.filter((r)=>r.success).length}/${results.length} sent. Last error: ${lastError}`);
  return { success: false, provider: "esms", simulated: false, to: formatted, results, error: lastError };
};

// Helper: Send OTP (uses same endpoint, just formatted text)
export const sendOTP = async ({ to, otp, senderId, purpose = "verification" }) => {
  if (!otp) otp = String(Math.floor(100000 + Math.random() * 900000));
  const text = `Your ${purpose} code is ${otp}. Valid for 5 minutes. Do not share.`;
  const res = await sendSMS({ to, text, senderId });
  return { ...res, otp };
};

// Helper: Check wallet balance (smsconnect or esms)
export const getSmsBalance = async () => {
  const smsConnectKey = process.env.SMSCONNECT_API_KEY;
  const smsConnectSecret = process.env.SMSCONNECT_API_SECRET;
  if (smsConnectKey) {
    const url = "https://smsconnect.tech/api/v1/user";
    const headers = { Authorization: `Bearer ${smsConnectKey}`, Accept: "application/json" };
    if (smsConnectSecret) headers["X-API-SECRET"] = smsConnectSecret;
    try {
      const res = await fetch(url, { headers });
      const data = await res.json().catch(()=>({ raw: "no json"}));
      if (res.ok) return { success: true, provider: "smsconnect", data: data.data || data };
      return { success: false, provider: "smsconnect", error: data };
    } catch (e) {
      return { success: false, provider: "smsconnect", error: e.message };
    }
  }
  const apiKey = process.env.ESMS_API_KEY || process.env.SMS_API_KEY;
  if (!apiKey) return { simulated: true, error: "No API key (SMSCONNECT_API_KEY or ESMS_API_KEY)" };
  const url = "https://sms.esmsafrica.io/api/balance";
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    const data = await res.json();
    if (res.ok) return { success: true, provider: "esms", data };
    return { success: false, provider: "esms", error: data };
  } catch (e) {
    return { success: false, provider: "esms", error: e.message };
  }
};

export default sendSMS;
