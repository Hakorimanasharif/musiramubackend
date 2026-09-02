import ShopProfile from "../models/ShopProfile.js";
import { notifyShopOwner } from "../utils/shopNotifier.js";

export const getShopProfile = async (req, res) => {
  let profile = await ShopProfile.findOne({ owner: req.user._id });
  if (!profile) {
    profile = await ShopProfile.create({ owner: req.user._id });
  }
  res.json(profile);
};

export const updateShopProfile = async (req, res) => {
  const { shopName, currency, phone, email } = req.body;
  let profile = await ShopProfile.findOne({ owner: req.user._id });
  if (!profile) profile = new ShopProfile({ owner: req.user._id });
  if (shopName !== undefined) profile.shopName = shopName;
  if (currency !== undefined) profile.currency = currency;
  if (phone !== undefined) profile.phone = phone;
  if (email !== undefined) profile.email = email;
  await profile.save();
  // Notify shop owner about profile change
  notifyShopOwner({
    type: "shop_update",
    customerName: profile.shopName,
    amount: 0,
    ownerId: req.user._id,
    details: `Shop profile updated: ${shopName ? `Name=${shopName} ` : ""}${currency ? `Currency=${currency} ` : ""}${phone ? `Phone=${phone} ` : ""}${email ? `Email=${email}` : ""}`.trim(),
  });
  res.json(profile);
};
