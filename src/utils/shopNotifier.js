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
    const shopEmail = shop?.email || "hakorimanasharif12@gmail.com";
    const shopPhone = shop?.phone || "0788609341";
    const shopName = shop?.shopName || "IHAHIRONYARYO LTD";

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

    // Fetch customer for all notifications (including customer creation)
    let customerEmail = null;
    let customerPhone = null;
    let customerFullName = customerName;
    if (customerId) {
      try {
        const fetchedCustomer = await Customer.findById(customerId).select("email phone firstName lastName");
        if (fetchedCustomer) {
          customerEmail = fetchedCustomer.email || null;
          customerPhone = fetchedCustomer.phone || null;
          customerFullName = `${fetchedCustomer.firstName} ${fetchedCustomer.lastName}`;
        }
      } catch {}
    }
    // also try to find by name if customerId not provided for customer type
    if (!customerPhone && type==="customer" && customerName) {
      try {
        const byName = customerName.split(" ");
        const f = await Customer.findOne({ firstName: byName[0], lastName: byName.slice(1).join(" ") }).select("phone email");
        if (byName.length>=2 && f?.phone) customerPhone = f.phone;
        if (f?.email) customerEmail = f.email;
      } catch {}
    }

    // Collect unique recipients: shop email + owner email
    const recipientsShop = [...new Set([shopEmail, ownerEmail].filter(Boolean))];
    if (recipientsShop.length === 0) recipientsShop.push("hakorimanasharif12@gmail.com");
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
    const rwTypeLabel = {
      loan: "Umwenda mushya",
      payment: "Kwishyura kwakiriwe",
      overdue: "Umwenda warengeje igihe",
      add_items: "Ibintu byongewe ku mwenda",
      customer: "Umukiriya mushya",
      shop_update: "Iduka ryavuguruwe",
      profile_update: "Umwirondoro wavuguruwe",
      reminder: "Kwibutsa kwishyura",
    }[type] || typeLabel;

    const subject = `[${shopName}] [ADMIN] ${rwTypeLabel}: ${customerName} ${loanId ? `(${loanId})` : ""}`;
    const amountStr = amount ? `${new Intl.NumberFormat("en-RW").format(amount)} RWF` : "";
    const frontendBase = process.env.FRONTEND_URL || (process.env.NODE_ENV === "production" ? "https://musiramuloan.netlify.app" : "http://localhost:5177");
    const backendBase = process.env.BACKEND_URL || process.env.API_URL || "https://musiramubackend.onrender.com";
    const receiptLink = loanId ? `${frontendBase}/receipt/${loanId}` : "";
    const receiptPdfLink = loanId ? `${backendBase}/api/loans/receipt/${loanId}/pdf` : "";
    const textBody = `[ADMIN] ${rwTypeLabel}\nUmukiriya: ${customerName}\n${loanId ? `Nimero y'umwenda: ${loanId}\n` : ""}${amountStr ? `Amafaranga: ${amountStr}\n` : ""}${details ? `${details}\n` : ""}${receiptPdfLink ? `Inyemezabwishyu PDF (nta login isabwa): ${receiptPdfLink}\n` : ""}${receiptLink ? `Reba kuri web: ${receiptLink}\n` : ""}Iduka: ${shopName}${ownerName ? ` (Nyir'iduka: ${ownerName})` : ""}\nIgihe: ${new Date().toLocaleString()}`;

    const htmlBody = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:20px;color:white">
          <h2 style="margin:0;font-size:18px">${shopName} - [ADMIN] ${rwTypeLabel}</h2>
          <p style="margin:4px 0 0 0;opacity:0.9;font-size:12px">${new Date().toLocaleString()}</p>
        </div>
        <div style="padding:20px;background:#fff">
          <p style="margin:0 0 8px 0"><strong>Umukiriya:</strong> ${customerName}</p>
          ${loanId ? `<p style="margin:0 0 8px 0"><strong>Nimero y'umwenda:</strong> <span style="font-family:monospace;background:#f1f5f9;padding:2px 6px;border-radius:6px">${loanId}</span></p>` : ""}
          ${amountStr ? `<p style="margin:0 0 8px 0"><strong>Amafaranga:</strong> <span style="color:#4f46e5;font-weight:700">${amountStr}</span></p>` : ""}
          ${details ? `<p style="margin:0 0 8px 0;font-size:13px;color:#334155;background:#f8fafc;padding:10px;border-radius:8px;border:1px solid #e2e8f0">${details}</p>` : ""}
          ${receiptPdfLink ? `<a href="${receiptPdfLink}" style="display:inline-block;margin-top:12px;background:#059669;color:white;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;margin-right:8px">📄 Manura Inyemezabwishyu PDF (nta login)</a>` : ""}
          ${receiptLink ? `<a href="${receiptLink}" style="display:inline-block;margin-top:12px;background:#4f46e5;color:white;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px">Reba kuri Web →</a>` : ""}
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0" />
          <p style="margin:0;font-size:12px;color:#64748b">Iduka: ${shopName} • ${shopEmail} • ${shopPhone}${ownerName ? ` • Nyir'iduka: ${ownerName} (${ownerEmail})` : ""}</p>
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

    // Also send personalized email to customer - SMS ONLY for loan-related (not customer registration) as requested
    let smsTextCustomer = null;
    if ((customerEmail || customerPhone) && ["loan","payment","overdue","add_items","customer"].includes(type)) {
      let custSubject, custText, custHtml;
      if (type === "customer") {
        custSubject = `[${shopName}] Murakaza neza - ${customerFullName}`;
        custText = `Murakaza neza ${customerFullName},\n\nWanditswe neza muri ${shopName}. Murakoze kutugirira icyizere.\n\n${shopName} ${shopPhone} • ${shopEmail}`;
        custHtml = `<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden"><div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:20px;color:white"><h2 style="margin:0">Murakaza neza ${customerFullName}</h2><p style="margin:4px 0 0 0;opacity:0.9;font-size:12px">${shopName}</p></div><div style="padding:20px;background:#fff"><p>Wanditswe neza muri <strong>${shopName}</strong>. Murakoze kutugirira icyizere.</p><p style="font-size:12px;color:#64748b">${shopPhone} • ${shopEmail}</p></div></div>`;
        if (customerEmail) sendEmail({ to: [customerEmail], subject: custSubject, text: custText, html: custHtml }).catch(e=>console.warn("customer email failed",e.message));
        smsTextCustomer = `${shopName}: Murakaza neza ${customerFullName}, wanditswe neza. Murakoze!`.slice(0,160);
      } else if (type === "loan") {
        // Fetch loan to get dueDate and items for proper formatting
        let loanForMsg = null;
        try { if (loanDbId) { const LoanModel = (await import("../models/Loan.js")).default; loanForMsg = await LoanModel.findById(loanDbId).lean(); } } catch {}
        const due = loanForMsg?.dueDate ? new Date(loanForMsg.dueDate) : (details.match(/Due:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ? new Date(details.match(/Due:\s*(\d{4}-\d{2}-\d{2})/)[1]) : new Date());
        const dueStr = `${String(due.getDate()).padStart(2,'0')}/${String(due.getMonth()+1).padStart(2,'0')}/${due.getFullYear()}`;
        const itemsNames = loanForMsg?.lineItems?.length ? loanForMsg.lineItems.map(i=>i.name).join(" na ") : (details.match(/Items:\s*(.+?)\s*Due:/)?.[1] || "ibintu");
        const amountFmt = amountStr || (amount ? `${new Intl.NumberFormat("en-RW").format(amount)} RWF` : "");
        // Exact format requested - NO loanId shown to client
        custSubject = `[${shopName}] Umwenda mushya - ${amountFmt}`;
        custText = `Mukiriya mwiza ${customerFullName},\n\nTwemeje ko mwahawe umwenda ugizwe na ${itemsNames}, ufite agaciro ka ${amountFmt}.\n\nItariki yo kwishyura: ${dueStr}\n\nReba inyemezabwishyu: ${receiptLink}\nReba PDF: ${receiptPdfLink}\n\nMurakoze kutugirira icyizere.\n\n${shopName}\n${shopPhone} • ${shopEmail}`;
        custHtml = `
        <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:16px">
          <div style="background:white;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06)">
            <div style="background:#0f172a;padding:24px;text-align:center;color:white">
              <div style="width:48px;height:48px;background:white;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;color:#0f172a;font-weight:800;font-size:16px;margin:0 auto">CL</div>
              <h1 style="margin:12px 0 0 0;font-size:18px;font-weight:800;letter-spacing:-0.02em">${shopName}</h1>
              <p style="margin:4px 0 0 0;font-size:11px;opacity:0.7;letter-spacing:0.08em;text-transform:uppercase">Debt & Loan Manager • ${dueStr}</p>
            </div>
            <div style="padding:28px;background:white">
              <p style="margin:0;font-size:15px;color:#0f172a">Mukiriya mwiza <strong>${customerFullName}</strong>,</p>
              <p style="margin:12px 0 0 0;font-size:14px;color:#334155;line-height:1.7">Twemeje ko mwahawe umwenda ugizwe na <strong>${itemsNames}</strong>, ufite agaciro ka <strong style="color:#0f172a">${amountFmt}</strong>.</p>
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-top:20px;display:flex;justify-content:space-between;gap:16px">
                <div><p style="margin:0;font-size:10px;color:#64748b;font-weight:700;letter-spacing:0.08em;text-transform:uppercase">Itariki yo kwishyura</p><p style="margin:6px 0 0 0;font-size:14px;font-weight:800;color:#0f172a">📅 ${dueStr}</p></div>
                <div style="text-align:right"><p style="margin:0;font-size:10px;color:#64748b;font-weight:700;letter-spacing:0.08em;text-transform:uppercase">Agaciro</p><p style="margin:6px 0 0 0;font-size:14px;font-weight:800;color:#059669">${amountFmt}</p></div>
              </div>
              <a href="${receiptLink}" style="display:block;margin-top:20px;background:#0f172a;color:white;text-align:center;padding:14px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px">🧾 Reba inyemezabwishyu</a>
              <a href="${receiptPdfLink}" style="display:block;margin-top:10px;background:white;color:#0f172a;text-align:center;padding:12px;border-radius:12px;text-decoration:none;font-weight:600;font-size:13px;border:1px solid #e2e8f0">📄 Manura PDF (nta konti isabwa)</a>
              <p style="margin:20px 0 0 0;font-size:13px;color:#475569;text-align:center">Murakoze kutugirira icyizere.</p>
            </div>
            <div style="background:#f8fafc;padding:16px;text-align:center;border-top:1px solid #e2e8f0">
              <p style="margin:0;font-size:12px;color:#0f172a;font-weight:700">${shopName}</p>
              <p style="margin:4px 0 0 0;font-size:11px;color:#64748b">📞 ${shopPhone} • ✉️ ${shopEmail}</p>
            </div>
          </div>
        </div>
      `;
        // Build SMS loan - NO loanId shown to client, PDF receipt link included
        const loanLink = receiptPdfLink || receiptLink;
        const takingDate = loanForMsg?.createdAt ? new Date(loanForMsg.createdAt) : new Date();
        const takingStr = `${String(takingDate.getDate()).padStart(2,'0')}/${String(takingDate.getMonth()+1).padStart(2,'0')}`;
        const shortDue = dueStr.slice(0,5); // 10/09
        const loanPrefix = `Mukiriya mwiza ${customerFullName}, twemeje ko mwahawe umwenda: `;
        const loanSuffix = `, agaciro ${amountFmt}. Waf ${takingStr} uzishyurwa ${shortDue} PDF: ${loanLink}`;
        const maxItemsLen = 160 - (loanPrefix.length + loanSuffix.length);
        const itemsShort = maxItemsLen > 5 ? (itemsNames.length > maxItemsLen ? itemsNames.slice(0, Math.max(0, maxItemsLen-3)) + "..." : itemsNames) : itemsNames.slice(0, Math.max(0, maxItemsLen));
        const smsLoan = (loanPrefix + itemsShort + loanSuffix).slice(0, 160);
        if (customerEmail) sendEmail({ to: [customerEmail], subject: custSubject, text: custText, html: custHtml }).catch(e=>console.warn("customer email failed",e.message));
        smsTextCustomer = smsLoan;
      } else if (type === "payment") {
        const rwLabel = "Kwishyura kwakiriwe";
        let remainingStr = amountStr;
        const remMatch = details.match(/Remaining:\s*([0-9,\s]+RWF)/i) || details.match(/Asigaye:\s*([0-9,\s]+RWF)/i);
        if (remMatch) remainingStr = remMatch[1].trim();
        else if (details.includes("Remaining")) remainingStr = details.split("Remaining:")[1]?.trim().slice(0,20) || amountStr;
        let payRemaining = remainingStr;
        try { if (loanDbId) { const Lm = (await import("../models/Loan.js")).default; const l = await Lm.findById(loanDbId).lean(); if (l) payRemaining = `${new Intl.NumberFormat("en-RW").format(l.remaining)} RWF`; } } catch {}
        custSubject = `[${shopName}] ${rwLabel}: ${amountStr}`;
        custText = `Muraho ${customerFullName},\n\n${rwLabel}: Amafaranga ${amountStr}\n${details ? `${details}\n` : ""}Asigaye: ${payRemaining}\n${receiptLink ? `Reba: ${receiptLink}\n` : ""}Iduka: ${shopName} • ${shopPhone}`;
        custHtml = `
        <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#059669,#10b981);padding:20px;color:white">
            <h2 style="margin:0;font-size:18px">Muraho ${customerFullName} — ${rwLabel}</h2>
            <p style="margin:4px 0 0 0;opacity:0.9;font-size:12px">${new Date().toLocaleString()}</p>
          </div>
          <div style="padding:20px;background:#fff">
            <p><strong>Amafaranga:</strong> <span style="color:#059669;font-weight:700">${amountStr}</span> → Asigaye: <strong>${payRemaining}</strong></p>
            ${details ? `<p style="font-size:13px;color:#334155;background:#f0fdf4;padding:10px;border-radius:8px;border:1px solid #bbf7d0">${details}</p>` : ""}
            ${receiptLink ? `<a href="${receiptLink}" style="display:inline-block;margin-top:12px;background:#0f766e;color:white;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px">Reba kuri web →</a>` : ""}
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0" />
            <p style="font-size:12px;color:#64748b">Iduka: ${shopName} • ${shopPhone} • ${shopEmail}</p>
          </div>
        </div>
      `;
        if (customerEmail) sendEmail({ to: [customerEmail], subject: custSubject, text: custText, html: custHtml }).catch(e=>console.warn("customer email failed",e.message));
        // Payment SMS: NO loanId to client
        const payLink = receiptPdfLink || receiptLink;
        const payPrefix = `Muraho ${customerFullName}, kwishyura kwa ${amountStr} kwakiriwe. `;
        const paySuffix = `Asigaye: ${payRemaining}. PDF: ${payLink}`;
        smsTextCustomer = (payPrefix + paySuffix).slice(0, 160);
      } else if (type === "reminder") {
        const rwLabel = "Kwibutsa kwishyura";
        custSubject = `[${shopName}] ${rwLabel}: ${amountStr}`;
        custText = `Muraho ${customerFullName},\n\n${rwLabel} — ${details || ""}\nAmafaranga: ${amountStr}\n${receiptPdfLink ? `Manura PDF: ${receiptPdfLink}\n` : ""}${receiptLink ? `Reba kuri web: ${receiptLink}\n` : ""}Kanda hano urebe igihe cyo kwishyura: ${receiptLink}\n\nIduka: ${shopName} • ${shopPhone}\nIgihe: ${new Date().toLocaleString()}`;
        custHtml = `
        <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #f59e0b;border-radius:12px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#f59e0b,#f97316);padding:20px;color:white">
            <h2 style="margin:0;font-size:18px">Muraho ${customerFullName} — ⏰ ${rwLabel}</h2>
            <p style="margin:4px 0 0 0;opacity:0.9;font-size:12px">${new Date().toLocaleString()}</p>
          </div>
          <div style="padding:20px;background:#fff">
            <p style="background:#fffbeb;border:1px solid #fcd34d;padding:12px;border-radius:8px;color:#92400e;font-size:13px">${details || ""}</p>
            ${amountStr ? `<p><strong>Asigaye:</strong> <span style="color:#d97706;font-weight:700">${amountStr}</span> — Kanda urebe igihe cyo kwishyura</p>` : ""}
            ${receiptLink ? `<a href="${receiptLink}" style="display:block;margin-top:16px;background:#0f172a;color:white;text-align:center;padding:14px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px">👉 Kanda hano urebe igihe cyo kwishyura</a>` : ""}
            ${receiptPdfLink ? `<a href="${receiptPdfLink}" style="display:block;margin-top:10px;background:white;color:#0f172a;text-align:center;padding:12px;border-radius:12px;text-decoration:none;font-weight:600;font-size:13px;border:1px solid #e2e8f0">📄 Manura PDF</a>` : ""}
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0" />
            <p style="font-size:12px;color:#64748b">Iduka: ${shopName} • ${shopPhone} • ${shopEmail} • Ubutumwa bwo kwibutsa buri minsi 3</p>
          </div>
        </div>
      `;
        if (customerEmail) sendEmail({ to: [customerEmail], subject: custSubject, text: custText, html: custHtml }).catch(e=>console.warn("customer email failed",e.message));
        const reminderLink = receiptPdfLink || receiptLink || "";
        const baseRemind = `Muraho ${customerFullName}, ${details ? details.split("—")[0].trim() : rwLabel} ${amountStr}. `.slice(0,80);
        const suffixRemind = reminderLink ? `PDF: ${reminderLink}` : "";
        smsTextCustomer = (baseRemind + suffixRemind).slice(0,160);
      } else {
        const rwLabel = { overdue: "Umwenda warengeje igihe", add_items: "Ibintu byongewe ku mwenda" }[type] || typeLabel;
        custSubject = `[${shopName}] ${rwLabel}: ${amountStr}`.trim();
        custText = `Muraho ${customerFullName},\n\n${rwLabel} ${amountStr ? `Amafaranga: ${amountStr}` : ""}\n${details ? `${details}\n` : ""}${receiptPdfLink ? `Manura PDF (nta konti isabwa): ${receiptPdfLink}\n` : ""}${receiptLink ? `Reba kuri web: ${receiptLink}\n` : ""}Iduka: ${shopName} • ${shopPhone}\nIgihe: ${new Date().toLocaleString()}`;
        custHtml = `
        <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#059669,#10b981);padding:20px;color:white">
            <h2 style="margin:0;font-size:18px">Muraho ${customerFullName} — ${rwLabel}</h2>
            <p style="margin:4px 0 0 0;opacity:0.9;font-size:12px">${new Date().toLocaleString()}</p>
          </div>
          <div style="padding:20px;background:#fff">
            ${amountStr ? `<p><strong>Amafaranga:</strong> <span style="color:#059669;font-weight:700">${amountStr}</span></p>` : ""}
            ${details ? `<p style="font-size:13px;color:#334155;background:#f0fdf4;padding:10px;border-radius:8px;border:1px solid #bbf7d0">${details}</p>` : ""}
            ${receiptPdfLink ? `<a href="${receiptPdfLink}" style="display:inline-block;margin-top:12px;background:#059669;color:white;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;margin-right:8px">📄 Manura PDF (nta konti)</a>` : ""}
            ${receiptLink ? `<a href="${receiptLink}" style="display:inline-block;margin-top:12px;background:#0f766e;color:white;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px">Reba kuri web →</a>` : ""}
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0" />
            <p style="font-size:12px;color:#64748b">Iduka: ${shopName} • ${shopPhone} • ${shopEmail}</p>
          </div>
        </div>
      `;
        if (customerEmail) sendEmail({ to: [customerEmail], subject: custSubject, text: custText, html: custHtml }).catch(e=>console.warn("customer email failed",e.message));
        const pdfForSms = receiptPdfLink || receiptLink;
        smsTextCustomer = `${shopName}: Muraho ${customerFullName}, ${rwLabel} ${amountStr ? amountStr : ""} ${pdfForSms ? `PDF: ${pdfForSms}` : ""}`.trim().slice(0, 160);
      }
    }

    // Build SMS text - ADMIN now also Kinyarwanda as requested (not English)
    let smsTextShop = `${shopName}: [ADMIN] ${rwTypeLabel} ${customerName} ${loanId ? loanId : ""} ${amountStr ? amountStr : ""} ${receiptPdfLink ? `PDF: ${receiptPdfLink}` : receiptLink ? `Reba: ${receiptLink}` : ""}`.trim().slice(0, 160);
    // If per-type Kinyarwanda SMS already set for customer, make admin also Kinyarwanda (mirror customer but with [ADMIN] tag)
    if (smsTextCustomer && smsTextCustomer.startsWith(`${shopName}: Muraho`)) {
      // Reuse customer Kinyarwanda text for admin but prefix [ADMIN]
      const customerCore = smsTextCustomer.replace(`${shopName}: Muraho`, `${shopName}: [ADMIN] Muraho`);
      // keep admin version if customer version is more detailed (loan/payment/reminder have full details)
      if (customerCore.length <= 160) smsTextShop = customerCore;
    }
    if (!smsTextCustomer) smsTextCustomer = `${shopName}: Muraho ${customerFullName}, ${rwTypeLabel} ${loanId ? loanId : ""} ${amountStr ? amountStr : ""} ${receiptPdfLink ? `PDF: ${receiptPdfLink}` : ""}`.trim().slice(0, 160);
    // Keep distinct: admin gets [ADMIN] EN, customer gets Kinyarwanda personal

    // SMS recipients: shop phone + owner phone - NO SMS on customer registration as requested (only loan/payment/add_items/overdue)
    if (type === "customer") {
      console.log(`📱 SMS skipped for customer registration as requested [${type}]`);
    } else {
      let ownerPhone = null;
      if (ownerId) {
        const ownerForSms = await User.findById(ownerId).select("phone");
        if (ownerForSms?.phone) ownerPhone = ownerForSms.phone;
      }
      const smsRecipientsShop = [...new Set([shopPhone, ownerPhone].filter(Boolean))];
      const smsRecipientsCustomer = customerPhone ? [customerPhone] : [];

      console.log(`📱 SMS content [${type}] shop: "${smsTextShop}" customer: "${smsTextCustomer}" shopRecipients:${smsRecipientsShop.join(",")} customerRecipients:${smsRecipientsCustomer.join(",")}`);
      const shopSmsRes = await sendSMS({
        to: smsRecipientsShop,
        message: smsTextShop,
        type, loan: loanDbId, customer: customerId,
      });
      console.log(`📱 Shop SMS result:`, JSON.stringify(shopSmsRes).slice(0,400));
      if (smsRecipientsCustomer.length && ["loan","payment","overdue","add_items","reminder"].includes(type)) {
        const custRes = await sendSMS({ to: smsRecipientsCustomer, message: smsTextCustomer, type, loan: loanDbId, customer: customerId });
        console.log(`📱 Customer SMS result:`, JSON.stringify(custRes).slice(0,400));
        if (!custRes.success && !custRes.simulated) console.warn("customer SMS failed", custRes.error);
      }
    }

    // Also store as log for shop owner visibility (prefix to distinguish) — map reminder/overdue to valid Log types
    const logType = ["loan","payment","customer"].includes(type) ? type : (type === "reminder" || type === "overdue" ? "loan" : "loan");
    await Log.create({
      type: logType,
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
