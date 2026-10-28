# Cloudflare food image API

This is the controlled-access API for restaurant apps. The current Vercel website remains live as the contributor/admin interface; this Worker is a separate API service and does not replace the current site.

## Access policy

- Restaurant apps receive a free API key only after contacting the owner.
- Customer keys are read-only. They are stored as SHA-256 hashes in D1 and are shown once when created.
- New contributors submit images through reviewed GitHub pull requests. Do not give contributors the owner key or direct database access.
- The owner key bypasses the application rate limiter. Cloudflare's account and free-plan request quotas still apply.
- Each customer key gets a strict, globally consistent Durable Object limit of 120 requests per minute and 5,000 requests per UTC day by default. The owner can lower limits for individual keys when issuing them.
- Image links returned by the API expire after 15 minutes. They are checked against the key's active status and use the same per-key rate limiter. Image bytes are edge-cached after the access checks.

The contact link is the owner's email from the supplied account screenshot. It is displayed by the app and returned on unauthenticated API responses. Change it in `wrangler.jsonc` if the public contact route changes.

## Create the Cloudflare resources

Install Wrangler in the repository and sign in:

```sh
npm install
npx wrangler login
```

Create the R2 bucket and D1 database:

```sh
npx wrangler r2 bucket create acropin-food-assets
npx wrangler d1 create acropin-food-catalog
```

Copy the D1 `database_id` returned by Wrangler into `wrangler.jsonc`, apply the schema, and deploy the Worker once:

```sh
npm run cloudflare:migrate
npm run cloudflare:deploy
```

The first deploy publishes the API at its `workers.dev` URL. It does not replace the Vercel website. Then create two long random secrets (use a password manager; never commit them or put them in Vite variables):

```sh
npx wrangler secret put OWNER_API_KEY
npx wrangler secret put IMAGE_URL_SECRET
```

Wrangler deploys the new secret versions when each command completes. Confirm with `curl https://YOUR_WORKER_DOMAIN/api/v1/health`.

## Issue and revoke customer keys

Use the owner key only from a trusted terminal or server. This returns a key once; give it only to the approved restaurant developer:

```sh
curl -X POST 'https://YOUR_WORKER_DOMAIN/api/v1/admin/keys' \
  -H "Authorization: Bearer $OWNER_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"label":"Restaurant name / production","requestsPerMinute":120,"requestsPerDay":5000}'
```

Revoke a leaked or retired key:

```sh
curl -X DELETE 'https://YOUR_WORKER_DOMAIN/api/v1/admin/keys/KEY_ID' \
  -H "Authorization: Bearer $OWNER_API_KEY"
```

List key labels, limits, and status (never the raw API keys):

```sh
curl 'https://YOUR_WORKER_DOMAIN/api/v1/admin/keys' \
  -H "Authorization: Bearer $OWNER_API_KEY"
```

## Customer API

```sh
curl 'https://YOUR_WORKER_DOMAIN/api/v1/catalog?search=pizza&limit=20' \
  -H 'Authorization: Bearer YOUR_APPROVED_API_KEY'
```

The catalog response includes signed `variants` with an image URL, pixel dimensions, format, and byte size for the available `480`, `960`, and `1600` pixel versions, plus attribution and license details. Use the URL matching the display size. Each image must already be processed as square WebP and uploaded by the owner to R2 before its variant is listed.

```json
{
  "slug": "classic-cheeseburger",
  "dishName": "Classic Cheeseburger",
  "variants": {
    "480": { "url": "https://...", "width": 480, "height": 480, "format": "webp", "byteSize": 23800 }
  }
}
```

To add an entry, first write its metadata with the owner key:

```sh
curl -X PUT 'https://YOUR_WORKER_DOMAIN/api/v1/admin/catalog/classic-cheeseburger' \
  -H "Authorization: Bearer $OWNER_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"dishName":"Classic Cheeseburger","category":"burgers","creator":"Acropin community contributor","tags":["beef","burger"],"license":"CC0-1.0","sourceUrl":"https://example.org/source","licenseEvidenceUrl":"https://example.org/license"}'
```

Then upload each preprocessed WebP variant:

```sh
curl -X PUT 'https://YOUR_WORKER_DOMAIN/api/v1/admin/catalog/classic-cheeseburger/variants/480.webp' \
  -H "Authorization: Bearer $OWNER_API_KEY" -H 'Content-Type: image/webp' --data-binary @480.webp
```

Repeat for 960 and 1600. Only approved catalog rows are returned publicly. Do not upload images without redistribution rights and accurate attribution.

## Current limits and remaining setup

This repository now contains the Cloudflare API and access controls, but it is not deployed yet: a Cloudflare account, D1 database ID, and two secrets are required. The current Vercel site is not switched over automatically. The new D1 catalog starts empty and needs approved images and variants imported before restaurants can fetch them.

After deploying the Worker, add the GitHub repository secrets `CLOUDFLARE_FOOD_API_URL` (the Worker base URL) and `CLOUDFLARE_OWNER_API_KEY`. Then each approved contribution merged to `main` is processed into WebP variants and synchronized to D1/R2 by `.github/workflows/sync-cloudflare-food-images.yml`. The workflow skips safely when these secrets are absent. Contributors only submit pull requests; they never receive the owner key or database credentials.

Cloudflare free-plan quotas remain a platform-level cap, including for the owner. Application rate-limit bypass does not make a free account unlimited. The API defaults to 120 requests per minute and 5,000 per UTC day per approved customer key; the owner may issue lower limits. Browser app keys can be extracted by end users, so issue one limited key per restaurant and use a backend proxy for sensitive integrations. Cache API edge caching requires a Worker custom domain/route; until one is assigned, browsers still honor the image response's five-minute cache header.

### Free-tier capacity at current documented limits

| Service used here | Free allowance | What it means for Acropin |
| --- | --- | --- |
| Workers | 100,000 incoming requests per day; 10 ms CPU per request ([limits](https://developers.cloudflare.com/workers/platform/limits/)) | Shared account-wide cap for the API; owner keys are still subject to it. |
| Durable Objects (SQLite) | 100,000 requests and 13,000 GB-s per day ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)) | The strict shared per-key limiter uses one Durable Object request for each catalog or image API request. |
| D1 | 5 million rows read and 100,000 rows written per day; 5 GB total SQL storage ([pricing](https://developers.cloudflare.com/d1/platform/pricing/)) | Stores API key hashes and approved image metadata; image bytes are not stored in D1. |
| R2 Standard | 10 GB-month storage, 1 million Class A and 10 million Class B operations per month; internet egress is free ([pricing](https://developers.cloudflare.com/r2/pricing/)) | Stores WebP variants and serves their bytes. |

These are service quotas, not guaranteed usage counts for each customer. Heavy usage by any one app can consume the shared free allowance; when free limits are reached, requests or storage operations may stop until reset or require a paid plan. The per-key application limits are 120 requests per minute and 5,000 per UTC day by default and can be lowered when a key is issued.

## GitHub automation settings

The npm release workflow uses the repository `GITHUB_TOKEN` to open release pull requests. In GitHub, open **Settings → Actions → General → Workflow permissions**, select **Read and write permissions**, and enable **Allow GitHub Actions to create and approve pull requests**. The Actions permissions radio (“Allow all actions and reusable workflows”) does not grant this separate pull-request permission. Store `CLOUDFLARE_FOOD_API_URL` and `CLOUDFLARE_OWNER_API_KEY` as repository Actions secrets after the Worker is deployed.

For npm releases, configure [trusted publishing](https://docs.npmjs.com/trusted-publishers/) in the `acropin-food-images` package settings on npmjs.com: GitHub organization/user `Acropin`, repository `Acropin-SharpVips`, and workflow filename `release-food-images.yml`. The publishing job already has OIDC `id-token: write` permission and uses Node 24/npm 12; trusted publishing avoids storing a long-lived npm publish token.
