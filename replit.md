# التزام (Eltizam) - Financial Management App

## Overview
A professional, mobile-first Arabic RTL financial management application built with React + Express + PostgreSQL. Features a native app-like feel with Tajawal font and full Arabic UI.

## Architecture
- **Frontend**: React + Vite + TailwindCSS v4 + Shadcn UI + TanStack Query
- **Backend**: Express.js with Passport.js local strategy authentication
- **Database**: PostgreSQL via Drizzle ORM (Neon serverless driver)
- **Auth**: Session-based with express-session + connect-pg-simple

## Data Model
- **users**: id, username, password (hashed), name, email
- **wallets**: id, userId, name, type, balance, color
- **categories**: id, userId, name, type (expense/income/debt), icon, color, budget
- **transactions**: id, userId, walletId, categoryId, type, amount, note, date

## Key Files
- `shared/schema.ts` - Drizzle schema + Zod validators
- `server/auth.ts` - Passport.js auth setup with register/login/logout
- `server/storage.ts` - DatabaseStorage class with all CRUD operations
- `server/routes.ts` - API routes (all prefixed with /api)
- `server/db.ts` - Neon/Drizzle database connection
- `client/src/lib/hooks.ts` - TanStack Query hooks for all API operations
- `client/src/components/layout.tsx` - Bottom nav + FAB + Add Transaction drawer
- `client/src/pages/` - Dashboard, Transactions, Wallets, Categories, Settings, Login

## API Endpoints
- `POST /api/register` - Create new user
- `POST /api/login` - Login
- `POST /api/logout` - Logout
- `GET /api/user` - Get current user
- `PATCH /api/user` - Update user profile
- `POST /api/user/change-password` - Change password
- `GET /api/dashboard` - Dashboard summary (balance, income, expenses, recent txs)
- `GET/POST /api/wallets` - List/create wallets
- `PATCH/DELETE /api/wallets/:id` - Update/delete wallet
- `GET/POST /api/categories` - List/create categories
- `PATCH/DELETE /api/categories/:id` - Update/delete category
- `GET/POST /api/transactions` - List/create transactions
- `DELETE /api/transactions/:id` - Delete transaction

## Design Choices
- RTL layout with `dir="rtl"` on HTML root
- Tajawal Google Font for Arabic typography
- TailwindCSS v4 with CSS variable design tokens (H S% L% format)
- Bottom navigation with 5 tabs + floating action button for adding transactions
- Drawer-based forms (Shadcn Drawer component)
- Wallet colors stored as Tailwind gradient class strings
