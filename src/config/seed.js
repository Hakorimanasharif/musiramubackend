import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Customer from "../models/Customer.js";
import Loan from "../models/Loan.js";
import Log from "../models/Log.js";
import ShopProfile from "../models/ShopProfile.js";

dotenv.config();

const customersData = [
  { firstName: "Aline", lastName: "Mukamana", phone: "0788123456", email: "aline.mukamana@gmail.com" },
  { firstName: "Jean", lastName: "Bosco", phone: "0788234567", email: "jean.bosco@yahoo.com" },
  { firstName: "Grace", lastName: "Uwase", phone: "0788345678", email: "grace.uwase@gmail.com" },
  { firstName: "Eric", lastName: "Niyomugabo", phone: "0788456789", email: "eric.niyo@gmail.com" },
  { firstName: "Diane", lastName: "Keza", phone: "0788567890", email: "diane.keza@outlook.com" },
  { firstName: "Patrick", lastName: "Hakizimana", phone: "0788678901", email: "patrick.h@gmail.com" },
];

const loansData = [
  { items: "12kg Rice, 5L Oil, Sugar 5kg", principal: 85000, remaining: 45000, status: "Pending", dueDate: "2026-08-30" },
  { items: "Cement 8 bags, Iron sheets 10pcs", principal: 320000, remaining: 320000, status: "Overdue", dueDate: "2026-08-10" },
  { items: "School uniform + Books", principal: 45000, remaining: 0, status: "Paid", dueDate: "2026-07-20" },
  { items: "Cooking Gas 12kg, Soap carton", principal: 38000, remaining: 38000, status: "Pending", dueDate: "2026-09-05" },
  { items: "Fridge - 2nd hand", principal: 180000, remaining: 120000, status: "Overdue", dueDate: "2026-08-18" },
  { items: "2x Mattresses + Bedsheets", principal: 95000, remaining: 95000, status: "Pending", dueDate: "2026-09-12" },
  { items: "Phone Samsung A14", principal: 210000, remaining: 0, status: "Paid", dueDate: "2026-07-30" },
  { items: "Maize flour 25kg, Beans 20kg", principal: 62000, remaining: 20000, status: "Pending", dueDate: "2026-08-28" },
  { items: "Hair dryer, Salon chairs", principal: 150000, remaining: 150000, status: "Overdue", dueDate: "2026-08-05" },
];

const seed = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Seeding...");
  await User.deleteMany();
  await Customer.deleteMany();
  await Loan.deleteMany();
  await Log.deleteMany();
  await ShopProfile.deleteMany();

  const admin = await User.create({ name: "Admin Doe", email: "admin@musiramu.rw", phone: "0788123456", password: "123456", role: "Shop Owner" });
  // also allow admin123
  await User.create({ name: "Admin", email: "admin2@musiramu.rw", phone: "0788000000", password: "123456", role: "Shop Owner" });

  const customers = await Customer.insertMany(customersData.map(c=>({...c, createdBy: admin._id})));
  console.log(`Created ${customers.length} customers`);

  for(let i=0;i<loansData.length;i++){
    const ld = loansData[i];
    const cust = customers[i % customers.length];
    const loanId = `L-${1001+i}`;
    await Loan.create({
      loanId,
      customer: cust._id,
      items: ld.items,
      lineItems: [{ name: ld.items.split(",")[0], qty: 1, price: ld.principal }],
      principal: ld.principal,
      remaining: ld.remaining,
      status: ld.status,
      dueDate: new Date(ld.dueDate),
      createdBy: admin._id,
    });
    await Log.create({ type: ld.status==="Paid"?"payment":"loan", customerName:`${cust.firstName} ${cust.lastName}`, amount: ld.principal, loanId, customer: cust._id });
  }
  await ShopProfile.create({ owner: admin._id, shopName:"MusiRamu General Shop", currency:"RWF", phone:"+250 788 123 456", email:"info@musiramu.rw" });
  console.log("Seed done. Admin: admin@musiramu.rw / 123456  or 0788123456 / 123456");
  process.exit(0);
};

seed().catch(e=>{console.error(e); process.exit(1)});
