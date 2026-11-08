# Shahvex AI

Single-agent physical-server rehearsal: [Windows/backend E2E instructions](docs/website-physical-e2e.md).

Physical-engine setup and authenticated network bridge: [docs/physical-engine-bridge.md](docs/physical-engine-bridge.md). Local gateway tests and protocol: [gateway/README.md](gateway/README.md). Security evidence and test diagnosis: [docs/security-review.md](docs/security-review.md).

## Local setup

Prices, balances and billing are stored in PKR. Users can select PKR or USD for
display; their choice is saved to their account and browser. USD amounts use
the open-source currency API's daily rate and are estimates; selecting a currency never
changes a stored price or a purchase request. If the provider is unavailable,
PKR remains available and USD conversion is disabled. An optional server setting
`EXCHANGE_RATE_USD_PKR` can supply an explicitly configured rate.

Email OTP resends use a 60-second server cooldown and a shared allowance of
5 resends per calendar day / 150 per calendar month for each normalized email
address, across verification purposes. Periods reset in Asia/Karachi time.
The initial delivery does not count as a resend; restarting a pending registration
does. Successful delivery replaces the previous code, which expires in 10 minutes.
Verification sessions last 24 hours, codes are hashed in PostgreSQL, and a code
can only be used once. Failed deliveries do not consume the allowance.
Authenticator-app login codes are generated on the user's device and have no resend.

Run `npm install`, fill the service credentials in `.env`, then run `npm run dev`.
`.env.example` documents every application environment variable without secrets.
The local `.env` includes generated authentication and encryption secrets; keep
those values private and stable. PostgreSQL is required for authentication and
workspace data. Set both `DATABASE_URL` and `DIRECT_URL` from your database provider.
Email, uploads, and calling additionally need their corresponding service settings.
For deployment, configure the same variables in your host and change
`NEXT_PUBLIC_SITE_URL` to your public HTTPS domain. Never commit `.env`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
