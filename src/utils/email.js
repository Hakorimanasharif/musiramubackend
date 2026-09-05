import nodemailer from "nodemailer";

let transporter = null;
let transporterVerified = false;

/**
 * Email sender - Nodemailer + Gmail / any SMTP
 * - If SMTP_HOST/USER/PASS set => real email (Gmail App Password, Brevo, etc.)
 * - Else if ETHEREAL_USER/PASS set => Ethereal test
 * - Else auto-creates Ethereal test account (dev) or console-simulated if offline
 * Shop notifications already call this + SMS together via shopNotifier.js
 */
const getTransporter = async () => {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // 465=SSL, 587=STARTTLS
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
    });
    console.log(`📧 SMTP configured: ${host}:${port} as ${user}`);
  } else if (process.env.ETHEREAL_USER && process.env.ETHEREAL_PASS) {
    transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      auth: { user: process.env.ETHEREAL_USER, pass: process.env.ETHEREAL_PASS },
    });
    console.log(`📧 Using provided Ethereal account: ${process.env.ETHEREAL_USER}`);
  } else {
    // Dev: auto-create Ethereal test account (requires internet)
    try {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        auth: { user: testAccount.user, pass: testAccount.pass },
      });
      console.log(`📧 [DEV] Auto-created Ethereal test account: ${testAccount.user}`);
      console.log(`📧 Preview URLs will be logged per email - open to view sent mail`);
      // Optionally persist to .env for reuse: ETHEREAL_USER/PASS
    } catch (e) {
      console.warn("⚠️  Email not configured & Ethereal unavailable (offline?). Set SMTP_HOST/USER/PASS in .env for real emails. Falling back to console-only.");
      console.warn("   Gmail: Enable 2FA -> https://myaccount.google.com/apppasswords -> Generate 'Mail' App Password (16 chars) -> SMTP_PASS=xxxx xxxx xxxx xxxx");
      return null;
    }
  }

  if (transporter && !transporterVerified) {
    try {
      await transporter.verify();
      transporterVerified = true;
      console.log("✅ Email transporter verified - ready to send");
    } catch (e) {
      console.warn("⚠️  Email transporter verify failed:", e.message);
      console.warn("   Check SMTP_HOST/PORT/USER/PASS. For Gmail: SMTP_HOST=smtp.gmail.com SMTP_PORT=587 SMTP_USER=your@gmail.com SMTP_PASS=app_password (no spaces)");
    }
  }
  return transporter;
};

export const sendEmail = async ({ to, subject, text, html }) => {
  if (!to) {
    console.warn("⚠️  sendEmail called without recipient");
    return { simulated: true, error: "no recipient" };
  }
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || "hakorimanasharif12@gmail.com";
  const recipients = Array.isArray(to) ? to.join(", ") : to;
  const shopName = process.env.SHOP_NAME || "IHAHIRO NYARYO(musiramu)";

  // Always log for debugging
  console.log(`\n📧 [EMAIL] To: ${recipients}\nSubject: ${subject}\nBody: ${text?.slice(0, 400)}...\n`);

  const t = await getTransporter();
  if (!t) {
    console.log("📧 [EMAIL SIMULATED] No SMTP / Ethereal - email logged to console only. Add SMTP_USER/PASS to send real emails.");
    return { simulated: true, to: recipients, subject };
  }

  try {
    const info = await t.sendMail({
      from: `"${shopName}" <${from}>`,
      to: recipients,
      subject,
      text,
      html: html || `<pre style="font-family:monospace;white-space:pre-wrap">${text}</pre>`,
    });
    console.log(`✅ Email sent to ${recipients} | MessageId: ${info.messageId}`);
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) console.log(`📧 Ethereal Preview URL: ${preview} (open in browser)`);
    return { success: true, messageId: info.messageId, preview, to: recipients };
  } catch (e) {
    console.error("❌ Failed to send email to", recipients, ":", e.message);
    // Don't throw - email failure should not break business flow (shopNotifier handles)
    return { error: e.message, simulated: true, to: recipients };
  }
};

// Helper for health check
export const getEmailStatus = async () => {
  const hasSmtp = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  const t = await getTransporter();
  return {
    configured: hasSmtp || !!t,
    simulated: !hasSmtp && !t,
    host: process.env.SMTP_HOST || "ethereal/console",
    from: process.env.EMAIL_FROM || process.env.SMTP_USER || "hakorimanasharif12@gmail.com",
    verified: transporterVerified,
  };
};

export default sendEmail;
