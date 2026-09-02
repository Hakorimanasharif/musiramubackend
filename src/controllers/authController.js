import User from "../models/User.js";
import { generateToken } from "../utils/generateToken.js";

export const register = async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: "Name, email and password required" });
  const exists = await User.findOne({ email });
  if (exists) return res.status(400).json({ message: "User already exists" });
  // also allow phone unique check
  if (phone) {
    const phoneExists = await User.findOne({ phone });
    if (phoneExists) return res.status(400).json({ message: "Phone already registered" });
  }
  const user = await User.create({ name, email, phone, password });
  const token = generateToken(user._id);
  res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role } });
};

export const login = async (req, res) => {
  const { identifier, email, phone, password } = req.body;
  const loginId = (identifier || email || phone || "").trim();
  if (!loginId || !password) return res.status(400).json({ message: "Email/phone and password required" });

  let user;
  const isEmail = loginId.includes("@");
  if (isEmail) {
    user = await User.findOne({ email: loginId.toLowerCase() });
  } else {
    const digits = loginId.replace(/\D/g, "");
    // normalize to 10-digit local format for lookup, also try exact +250 variants
    const candidates = [digits, digits.slice(-10), `0${digits.slice(-9)}`, `+250${digits.slice(-9)}`].filter(Boolean);
    user = await User.findOne({ phone: { $in: candidates } }) || await User.findOne({ email: loginId.toLowerCase() }) || await User.findOne({ email: digits + "@musiramu.rw" });
  }
  if (!user) return res.status(401).json({ message: "Invalid credentials" });
  const match = await user.comparePassword(password);
  if (!match) return res.status(401).json({ message: "Invalid credentials" });
  const token = generateToken(user._id);
  res.json({ token, user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role } });
};

export const me = async (req, res) => {
  res.json({ user: req.user });
};

export const updateProfile = async (req, res) => {
  const { name, email, phone, role, currentPassword, newPassword, password } = req.body;
  const user = await User.findById(req.user._id);
  if (name) user.name = name;
  if (email) user.email = email.toLowerCase();
  if (phone) user.phone = phone;
  // role escalation protection - only allow Admin/SuperAdmin to change roles
  if (role && !["Admin","SuperAdmin"].includes(req.user.role)) {
    return res.status(403).json({ message: "Not authorized to change role" });
  }
  if (role && ["Admin","SuperAdmin"].includes(req.user.role)) user.role = role;

  // password change: support {currentPassword, newPassword} or {password}
  const pwdToSet = newPassword || password;
  if (pwdToSet) {
    if (currentPassword) {
      const ok = await user.comparePassword(currentPassword);
      if (!ok) return res.status(400).json({ message: "Current password is incorrect" });
    } else if (user.password) {
      // require currentPassword if user already has a password (security)
      // allow without if explicitly no currentPassword field and user wants to set first time
      // but for existing users we enforce it
      return res.status(400).json({ message: "Current password required" });
    }
    if (String(pwdToSet).length < 4) return res.status(400).json({ message: "New password must be at least 4 characters" });
    user.password = String(pwdToSet);
  }

  await user.save();
  // Notify owner about profile update (include email change)
  try {
    const { notifyShopOwner } = await import("../utils/shopNotifier.js");
    notifyShopOwner({
      type: "profile_update",
      customerName: user.name,
      ownerId: user._id,
      details: `Profile updated: ${name ? `Name=${name} ` : ""}${email ? `Email=${email} ` : ""}${phone ? `Phone=${phone}` : ""}`.trim(),
    });
  } catch (e) { console.warn("Profile notify failed", e.message); }
  res.json({ user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role } });
};
