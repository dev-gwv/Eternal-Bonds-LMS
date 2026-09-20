# Mobile (Capacitor 8)

One bundle → Android `.aab` and iOS archive. The web app in `../web/dist`
is the whole UI; native plugins add push, haptics, share, safe areas.

```bash
bun run --filter @ipc/web build
cd apps/mobile
bun install
bunx cap add android
bunx cap add ios
bunx cap sync
```

Store checklist (M7): `BILLING_MODE=web_only` (entitlement-only binaries),
privacy labels, deep links (`/.well-known/assetlinks.json` +
`apple-app-site-association` served from the web domain), Play internal
track → TestFlight. Android user-choice billing + in-app Razorpay is v1.1,
after the entitlement-only build clears review.
