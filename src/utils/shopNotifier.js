import Log from "../models/Log.js";
import ShopProfile from "../models/ShopProfile.js";
import User from "../models/User.js";
import Customer from "../models/Customer.js";
import { sendEmail } from "./email.js";
import { sendSMS } from "./sms.js";

export const notifyShopOwner = async ({ type, customerName, amount = 0, loanId = "", loanDbId = null, customerId = null, ownerId, details = "" }) => {
  try {
    let shop = null;
    if (ownerId) shop = await ShopProfile.findOne({ owner: ownerId });
    if (!shop) shop = await ShopProfile.findOne();
    const shopEmail = shop?.email || "info@musiramu.rw";
    const shopPhone = shop?.phone || "+250 788 123 456";
    const shopName = shop?.shopName || "MusiRamu General Shop";

    // Also fetch owner user email directly
    let ownerEmail = null;
    let ownerName = null;
    if (ownerId) {
      const owner = await User.findById(ownerId).select("email name");
      if (owner) {
        ownerEmail = owner.email;
        ownerName = owner.name;
      }
    }

    // Fetch customer for loan-related notifications
    let customerEmail = null;
    let customerPhone = null;
    let customerFullName = customerName;
    if (customerId && ["loan","payment","overdue","add_items"].includes(type)) {
      try {
        const fetchedCustomer = await Customer.findById(customerId).select("email phone firstName lastName");
        if (fetchedCustomer) {
          customerEmail = fetchedCustomer.email || null;
          customerPhone = fetchedCustomer.phone || null;
          customerFullName = `${fetchedCustomer.firstName} ${fetchedCustomer.lastName}`;
        }
      } catch {}
    }

    // Collect unique recipients: shop email + owner email
    const recipientsShop = [...new Set([shopEmail, ownerEmail].filter(Boolean))];
    if (recipientsShop.length === 0) recipientsShop.push("info@musiramu.rw");
    const recipientsAll = [...new Set([...recipientsShop, ...(customerEmail ? [customerEmail] : [])].filter(Boolean))];

    const typeLabel = {
      loan: "New Loan Taken",
      payment: "Payment Received",
      overdue: "Customer Overdue",
      add_items: "Items Added to Loan",
      customer: "New Customer",
      shop_update: "Shop Profile Updated",
      profile_update: "Profile Updated",
    }[type] || type;

    const subject = `[${shopName}] ${typeLabel}: ${customerName} ${loanId ? `(${loanId})` : ""}`;
    const amountStr = amount ? `${new Intl.NumberFormat("en-RW").format(amount)} RWF` : "";
    const frontendBase = process.env.FRONTEND_URL || (process.env.NODE_ENV === "production" ? "https://musiramuloan.netlify.app" : "http://localhost:5177");
    const receiptLink = loanId ? `${frontendBase}/receipt/${loanId}` : "";
    const textBody = `${typeLabel}\nCustomer: ${customerName}\n${loanId ? `Loan: ${loanId}\n` : ""}${amountStr ? `Amount: ${amountStr}\n` : ""}${details ? `${details}\n` : ""}${receiptLink ? `Receipt: ${receiptLink}\n` : ""}Shop: ${shopName}${ownerName ? ` (Owner: ${ownerName})` : ""}\nTime: ${new Date().toLocaleString()}`;

    const htmlBody = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:20px;color:white">
          <h2 style="margin:0;font-size:18px">${shopName} - ${typeLabel}</h2>
          <p style="margin:4px 0 0 0;opacity:0.9;font-size:12px">${new Date().toLocaleString()}</p>
        </div>
        <div style="padding:20px;background:#fff">
          <p style="margin:0 0 8px 0"><strong>Customer:</strong> ${customerName}</p>
          ${loanId ? `<p style="margin:0 0 8px 0"><strong>Loan:</strong> <span style="font-family:monospace;background:#f1f5f9;padding:2px 6px;border-radius:6px">${loanId}</span></p>` : ""}
          ${amountStr ? `<p style="margin:0 0 8px 0"><strong>Amount:</strong> <span style="color:#4f46e5;font-weight:700">${amountStr}</span></p>` : ""}
          ${details ? `<p style="margin:0 0 8px 0;font-size:13px;color:#334155;background:#f8fafc;padding:10px;border-radius:8px;border:1px solid #e2e8f0">${details}</p>` : ""}
          ${receiptLink ? `<a href="${receiptLink}" style="display:inline-block;margin-top:12px;background:#4f46e5;color:white;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px">View Receipt →</a>` : ""}
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0" />
          <p style="margin:0;font-size:12px;color:#64748b">Shop: ${shopName} • ${shopEmail} • ${shopPhone}${ownerName ? ` • Owner: ${ownerName} (${ownerEmail})` : ""}</p>
        </div>
      </div>
    `;

    // Log to console for debug
    console.log(`\n📧 [SHOP EMAIL] To: ${recipientsShop.join(", ")}${customerEmail ? ` + Customer: ${customerEmail}` : ""}\nSubject: ${subject}\n`);

    // Send email to shop owner (shop-centric template)
    await sendEmail({
      to: recipientsShop,
      subject,
      text: textBody,
      html: htmlBody,
    });

    // Also send personalized email to customer for loan-related changes
    if (customerEmail && ["loan","payment","overdue","add_items"].includes(type)) {
      const custSubject = `[${shopName}] Your ${typeLabel}: ${loanId ? loanId : ""} ${amountStr}`.trim();
      const custText = `Hello ${customerFullName},\n\n${typeLabel} for your loan ${loanId || ""} ${amountStr ? `Amount: ${amountStr}` : ""}\n${details ? `${details}\n` : ""}${receiptLink ? `View receipt: ${receiptLink}\n` : ""}Shop: ${shopName} • ${shopPhone}\nTime: ${new Date().toLocaleString()}`;
      const custHtml = `
        <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#059669,#10b981);padding:20px;color:white">
            <h2 style="margin:0;font-size:18px">Hello ${customerFullName} — ${typeLabel}</h2>
            <p style="margin:4px 0 0 0;opacity:0.9;font-size:12px">${new Date().toLocaleString()}</p>
          </div>
          <div style="padding:20px;background:#fff">
            ${loanId ? `<p><strong>Loan:</strong> <span style="font-family:monospace;background:#f1f5f9;padding:2px 6px;border-radius:6px">${loanId}</span></p>` : ""}
            ${amountStr ? `<p><strong>Amount:</strong> <span style="color:#059669;font-weight:700">${amountStr}</span></p>` : ""}
            ${details ? `<p style="font-size:13px;color:#334155;background:#f0fdf4;padding:10px;border-radius:8px;border:1px solid #bbf7d0">${details}</p>` : ""}
            ${receiptLink ? `<a href="${receiptLink}" style="display:inline-block;margin-top:12px;background:#059669;color:white;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px">View Your Receipt →</a>` : ""}
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0" />
            <p style="font-size:12px;color:#64748b">Shop: ${shopName} • ${shopPhone} • ${shopEmail}</p>
          </div>
        </div>
      `;
      sendEmail({ to: [customerEmail], subject: custSubject, text: custText, html: custHtml }).catch(e=>console.warn("customer email failed",e.message));
    }

    // Build SMS text (160 chars friendly, with receipt link)
    const smsTextShop = `${shopName}: ${typeLabel} ${customerName} ${loanId ? loanId : ""} ${amountStr ? amountStr : ""} ${details ? `- ${details.slice(0, 60)}` : ""} ${receiptLink ? receiptLink : ""}`.trim().slice(0, 320);
    const smsTextCustomer = `${shopName}: Hi ${customerFullName}, ${typeLabel} ${loanId ? loanId : ""} ${amountStr ? amountStr : ""} ${receiptLink ? receiptLink : ""}`.trim().slice(0, 320);

    // SMS recipients: shop phone + owner phone
    let ownerPhone = null;
    if (ownerId) {
      const ownerForSms = await User.findById(ownerId).select("phone");
      if (ownerForSms?.phone) ownerPhone = ownerForSms.phone;
    }
    const smsRecipientsShop = [...new Set([shopPhone, ownerPhone].filter(Boolean))];
    const smsRecipientsCustomer = customerPhone ? [customerPhone] : [];

    await sendSMS({
      to: smsRecipientsShop,
      message: smsTextShop,
    });
    if (smsRecipientsCustomer.length && ["loan","payment","overdue","add_items"].includes(type)) {
      sendSMS({ to: smsRecipientsCustomer, message: smsTextCustomer }).catch(e=>console.warn("customer SMS failed",e.message));
    }

    // Also store as log for shop owner visibility (prefix to distinguish)
    await Log.create({
      type: type === "add_items" ? "loan" : type,
      customerName: `[SHOP] ${customerName} - ${typeLabel}`,
      amount,
      loanId,
      loan: loanDbId,
      customer: customerId,
    });

    return { shopEmail: recipientsShop.join(", "), shopPhone, subject, body: textBody };
  } catch (e) {
    console.error("Shop notify error:", e.message);
  }
};
