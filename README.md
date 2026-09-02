# CreditLedger Backend

Shop Debt & Loan Management System API

## Stack
- Node.js + Express
- MongoDB + Mongoose
- JWT (email/phone login)
- bcryptjs, cors, morgan

## Setup
```bash
cd backend
npm install
cp .env.example .env  # edit MONGO_URI if needed
npm run seed   # creates admin + 6 customers + 9 loans
npm run dev    # http://localhost:5000
```

Demo login:
- Email: `admin@musiramu.rw` / `123456`
- Phone: `0788123456` / `123456`

## API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /api/auth/register | - | Register |
| POST | /api/auth/login | - | Login with email or phone |
| GET | /api/auth/me | Bearer | Get profile |
| PUT | /api/auth/me | Bearer | Update profile |
| GET | /api/customers?search=&page= | Bearer | List customers |
| POST | /api/customers | Bearer | Create customer |
| GET | /api/customers/:id | Bearer | Customer detail + loans |
| GET | /api/loans?status=&search=&page= | Bearer | List loans (All/Pending/Overdue/Paid) |
| POST | /api/loans | Bearer | Create loan with lineItems |
| POST | /api/loans/:id/pay | Bearer | Collect payment {amount} |
| GET | /api/stats | Bearer | Stats + overdue + logs |
| GET | /api/shop | Bearer | Shop profile |
| PUT | /api/shop | Bearer | Update shop |
| POST | /api/sms/send | Bearer | Test send SMS {to, message} (eSMS Africa) |
| POST | /api/sms/otp | Bearer | Send OTP {to, purpose} |
| GET | /api/sms/balance | Bearer | Check eSMS wallet balance |
| GET | /api/sms/format?phone=0788... | Bearer | Debug phone formatter |
| GET | /api/email/status | Bearer | Email config status (real vs simulated) |
| POST | /api/email/send | Bearer | Test send email {to, subject, text, html} |
| POST | /api/email/test-notify | Bearer | Trigger Email+SMS together via shopNotifier |

## Frontend integration
Set `VITE_API_URL=http://localhost:5000` in frontend/.env

## Models
- User, Customer, Loan (with lineItems), ShopProfile, Log
# musiramubackend
