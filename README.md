# Acropin SharpVips

Acropin SharpVips contains a private owner dashboard, a reviewed npm image catalog, and a separately deployed API for restaurant applications. The repository does not ship demo restaurant menus or sample food images; the catalog starts empty until real contributions are reviewed.

## How the image library works

1. A contributor opens a pull request under `packages/food-images/contributions/<food-slug>/`, including an original image and its source, license evidence, attribution, and metadata.
2. GitHub Actions validates the metadata, rejects exact and near-duplicate image content using SHA-256 plus a 64-bit DCT perceptual hash, and builds optimized WebP variants. These checks validate files and required fields; a maintainer still reviews image rights and attribution before merging.
3. A contribution merged to `main` can be synchronized to the Cloudflare API when its Worker is deployed and the two Cloudflare repository secrets are configured.
4. Release Please opens a version pull request for `acropin-food-images`. Merging that release pull request publishes the npm package through npm trusted publishing. Apps install the released package with `npm install acropin-food-images`.

The dashboard's **Process & Contribute** form accepts submissions from approved GitHub contributors and the owner. Visitors can browse the approved catalog without signing in. Selecting an image or trying to submit while signed out opens an in-page sign-in dialog; GitHub OAuth opens in a popup so the selected image and form stay in the original page. A returning approved contributor continues without another prompt. A GitHub sign-in creates a contributor profile automatically; a new profile stays pending until the owner approves it in **Contributors**. Submissions enter the review queue by default. Each normalized dish slug is locked while its submission is pending, approved, or revoked, so contributors cannot submit the same dish repeatedly. SHA-256 rejects exact duplicates and a fast DCT perceptual hash rejects near-identical uploads across browser-file and image-URL submission routes. The perceptual hash detects visual similarity only; it does not establish license rights or whether an image was AI-generated. Rights still require image-specific CC0/CC-BY evidence and human review. Rejecting or deleting an image releases that dish lock. Dashboard approval does not create a GitHub contribution, publish an npm release, or synchronize the image to Cloudflare. Use the reviewed contribution pull request workflow for images intended for every package/API consumer.

## Storage and services

- The Vercel dashboard stores its owner-managed catalog, inventory targets, and upload records as private JSON/image blobs when Vercel Blob is connected. Local development writes to `.local-data/`; tests use a temporary directory.
- The restaurant-facing Cloudflare Worker uses D1 for approved image metadata and hashed API keys, R2 for WebP bytes, and a Durable Object for per-key rate limits.
- These are separate systems. Direct dashboard uploads do not automatically become Cloudflare API records. The reviewed Git contribution and release/sync workflows are the shared-library path.
- A structurally valid image is not automatically recognized as food. If `GEMINI_API_KEY` is absent or vision inspection fails, only image integrity checks run and the submission remains for human review. No ML verification claim is made in that fallback.

## Run locally

Use Node.js 24 and npm. Then run:

```sh
npm ci
npm run dev
```

Useful checks:

```sh
npm test
npm run lint
npm run cloudflare:lint
npm run build
```

The local dashboard is at `http://localhost:3000`. Create `.env` from `.env.example` as needed. For local development, an admin token is optional; without it, the local API treats the browser as the administrator, so set a local `ADMIN_API_TOKEN` when checking the contributor sign-in/approval path. Do not expose that dev server to the public internet.

## Vercel dashboard configuration

Set these server-side environment variables in the Vercel project and redeploy:

- `ADMIN_API_TOKEN`: a long random access code for the owner dashboard. Production and preview dashboard APIs fail closed without it.
- `BLOB_READ_WRITE_TOKEN`: connect a private Vercel Blob store so uploads and mutable app data survive function restarts.
- `GEMINI_API_KEY`: optional vision inspection. Without it, only structural file checks run; all submissions still require human review.

The dashboard prompts for the admin access code and stores it only for the current browser session. Public image delivery includes approved records only. Its cache lifetime is short so revocations can propagate.

For contributor sign-in, create a GitHub OAuth App with callback URL `https://YOUR_PRODUCTION_HOST/api/auth/github/callback`, then set these server-side Vercel variables:

- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_OAUTH_CALLBACK_URL` (the exact callback URL registered with GitHub)
- `GITHUB_SESSION_SECRET` (at least 32 random characters; generate with `openssl rand -base64 48`)

The callback uses GitHub's OAuth web flow and requests only the public profile. Contributor records are private Vercel Blob JSON objects under `app-data/contributors/`. A separate local OAuth App should use `http://localhost:3000/api/auth/github/callback`; add the local values to `.env` only. Keep OAuth secrets server-side and never prefix them with `VITE_`. The owner reviews new profiles in the Contributors tab and can approve or block access. New and active contributors still cannot edit the dish dataset, review submissions, or approve uploads.

Approved contributors can submit up to three unique dish images per UTC day by default (`GITHUB_CONTRIBUTOR_DAILY_LIMIT`, configurable from 1 to 20). Failed processing releases its reserved daily slot. Admin requests authenticated with `ADMIN_API_TOKEN` bypass the contributor cap.

Dish locks use unique, private Vercel Blob paths with overwrite disabled, so two Vercel function instances cannot reserve the same new dish at once. The catalog check also prevents duplicates for images already present in the reviewed npm package.

## Cloudflare API deployment

The Worker is a separate service. Follow [`cloudflare/README.md`](cloudflare/README.md) to provision D1, R2, the Durable Object, and the two Worker secrets, then deploy with `npm run cloudflare:deploy`. The metadata database and bucket must exist before the sync workflow can publish the reviewed package catalog.

After deploying, add these GitHub Actions repository secrets:

- `CLOUDFLARE_FOOD_API_URL`: the deployed Worker base URL.
- `CLOUDFLARE_OWNER_API_KEY`: the Worker owner key used only by the sync workflow.

Restaurant teams receive separate read-only API keys from the owner. Do not share the Worker owner key or database credentials with contributors or restaurant apps.

## GitHub and npm automation setup

The release workflow needs repository Actions permission **Allow GitHub Actions to create and approve pull requests**, in addition to workflow read/write permissions. The npm publishing job uses OIDC; configure npm trusted publishing for organization/user `Acropin`, repository `Acropin-SharpVips`, and workflow `release-food-images.yml`.

If these external settings or secrets are missing, GitHub cannot create release pull requests, publish to npm, or sync the Cloudflare catalog. A green Vercel deployment alone does not confirm those workflows are configured.
