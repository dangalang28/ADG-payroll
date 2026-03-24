# ADG Staffing — Payroll & Billing Dashboard

Weekly payroll consolidation dashboard that imports time data from OneVision and RedOak, normalizes it against a contractor roster, and exports a **Paychex SPI-compatible CSV** for direct upload to Paychex Flex.

## Features

- **Setup** — Paychex Company ID, pay components, week ending, target margin
- **Dashboard** — Weekly/YTD payroll, billing, margin with client breakdown
- **Contractors** — Full roster with pay rates, bill rates, Worker IDs
- **Rate Card** — Default billing rates by job title (Qarbon/RedOak)
- **Import** — CSV drop zones for OneVision, RedOak, plus manual entry
- **Name Match** — Auto-detect and map mismatched imported names
- **Time Entries** — Review/delete entries before export
- **Paychex Export** — Preview and download SPI-format CSV

## Deploy to Vercel

### Option 1: Vercel CLI (fastest)

```bash
npm i -g vercel
cd adg-payroll-dashboard
vercel
```

Follow the prompts. Done.

### Option 2: GitHub → Vercel

1. Push this folder to a GitHub repo:
   ```bash
   cd adg-payroll-dashboard
   git init
   git add .
   git commit -m "ADG Payroll Dashboard"
   gh repo create adg-payroll-dashboard --private --push
   ```

2. Go to [vercel.com/new](https://vercel.com/new)
3. Import the repo
4. Framework preset: **Next.js** (auto-detected)
5. Click **Deploy**

Every push to `main` will auto-deploy.

### Option 3: Manual upload

1. Build locally:
   ```bash
   npm install
   npm run build
   ```
2. Drag the project folder into [vercel.com/new](https://vercel.com/new)

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Paychex SPI Format

The exported CSV follows the Paychex Standard Payroll Import specification:

| Column | Description |
|--------|-------------|
| Company ID | Your Paychex company ID (default: 70157401) |
| Worker ID | Employee's Paychex Worker ID |
| Pay Component | Earning type: Hourly, Overtime reg amt, Per Diem Non Tax |
| Rate | Pay rate for this component |
| Hours | Hours worked (1.00 for flat per diem) |
| Amount | Rate × Hours |
| Check Seq Number | Left blank for new checks |
| Start Date | Pay period start (MM/DD/YYYY) |
| End Date | Pay period end / week ending (MM/DD/YYYY) |

Upload to Paychex Flex: **Payroll → Active → Browse Files**

> **Important:** SPI import must be enabled on your Paychex account. Contact your Paychex rep if you haven't set this up yet.

## Tech Stack

- Next.js 14 (App Router)
- React 18
- Deployed on Vercel (zero config)
- No database — all state is client-side per session
