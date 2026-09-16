import ShopProfile from "../models/ShopProfile.js";
import { notifyShopOwner } from "../utils/shopNotifier.js";
import { formatRwPhone } from "../utils/sms.js";

export const getShopProfile = async (req, res) => {
  let profile = await ShopProfile.findOne({ owner: req.user._id });
  if (!profile) {
    profile = await ShopProfile.create({ owner: req.user._id });
  }
  res.json(profile);
};

export const updateShopProfile = async (req, res) => {
  const { shopName, currency, phone, smsPhone, email, notifications } = req.body;
  let profile = await ShopProfile.findOne({ owner: req.user._id });
  if (!profile) profile = new ShopProfile({ owner: req.user._id });
  if (shopName !== undefined) profile.shopName = shopName;
  if (currency !== undefined) profile.currency = currency;
  if (phone !== undefined) {
    // Validate public shop contact — must be a dialable number
    if (phone && !formatRwPhone(phone)) return res.status(400).json({ message: "Invalid shop phone — use 10 digits like 0788609341" });
    profile.phone = phone;
  }
  if (smsPhone !== undefined) {
    // Dedicated admin SMS alert number — empty = fall back to `phone`.
    // Validated now so loan/payment SMS never silently drops later.
    if (smsPhone && !formatRwPhone(smsPhone)) return res.status(400).json({ message: "Invalid SMS alert number — use 10 digits like 0788609341" });
    profile.smsPhone = smsPhone ? String(smsPhone).replace(/\D/g, "") : "";
  }
  if (email !== undefined) profile.email = email;
  if (notifications && typeof notifications === "object") {
    profile.notifications = { ...profile.notifications, ...notifications };
  }
  await profile.save();
  // Notify shop owner about profile change
  notifyShopOwner({
    type: "shop_update",
    customerName: profile.shopName,
    amount: 0,
    ownerId: req.user._id,
    details: `Shop profile updated: ${shopName ? `Name=${shopName} ` : ""}${currency ? `Currency=${currency} ` : ""}${phone ? `Phone=${phone} ` : ""}${smsPhone !== undefined ? `SMS alerts=${smsPhone || "(fallback to shop phone)"} ` : ""}${email ? `Email=${email}` : ""}`.trim(),
  });
  res.json(profile);
};
