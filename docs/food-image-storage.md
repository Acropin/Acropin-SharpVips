# Food image storage setup

The food image library uses three services with separate responsibilities:

- **Vercel** runs the app and API. It issues short-lived ImageKit upload authorization and validates each completed upload.
- **Firebase Firestore** stores food image metadata and approval status, restaurant menus, dataset targets, GitHub contributor profiles and access decisions, dish contribution locks, daily contributor limits, and one-use upload intents.
- **ImageKit** receives image bytes directly from the browser, stores private originals, and delivers signed, transformed image URLs.

The project requires Node.js 22 or newer because the Firebase Admin SDK uses Node 22+. Vercel currently supports Node 22 and newer LTS versions; the project declares the minimum in `package.json`.

Vercel Blob is only the temporary legacy source during migration. It must not be used as the normal runtime store after migration. The existing contributor sign-in and review workflow remains unchanged; its profiles and access decisions are copied into Firestore. Legacy Blob objects are kept as a recovery copy until every record and image has been verified.

## Configure the services

1. In Firebase, create a project and enable Cloud Firestore. Create a service account for the server. Grant it only the Firestore role needed to read and write the database (for example, Cloud Datastore User). Enable Firestore TTL on the `expireAt` timestamp field for `imageUploadIntents` and `contributorDailyLimits` so expired upload tickets and daily counter documents are cleaned up automatically.
2. Add `FIREBASE_PROJECT_ID` and the service account JSON as the server-only Vercel environment variables `FIREBASE_PROJECT_ID` and `FIREBASE_SERVICE_ACCOUNT_JSON`. The JSON can be pasted as one line; preserve the `\\n` sequences inside `private_key`.
3. In ImageKit, copy the public key, private key, and URL endpoint from the developer settings. Add them as `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, and `IMAGEKIT_URL_ENDPOINT` in Vercel. Keep the private key server-only; never use a `VITE_` prefix.
4. Keep the original private Vercel Blob store connected until its records and images have been copied and verified. Do not create a replacement store or delete the source. A `403 Forbidden` means migration cannot read the source; do not initialize empty Firestore collections or mark the migration complete to work around it.
5. Redeploy Vercel after changing provider configuration. The app imports JSON records to Firestore on first initialization. The image binary copy remains an explicit dry-run-first step below.

Direct uploads use two Vercel function requests per contribution (authorize, then validate/process), but the image bytes skip Vercel's incoming request-body limit and Vercel Blob. This moves file storage and image delivery away from Blob; it does not remove Vercel's function invocation quota. Direct uploads are enabled only when both Firestore and ImageKit are configured. The authorization endpoint gives the browser a short-lived, randomized upload name, private-file setting, ImageKit size/MIME checks, and a one-use completion ticket. Image bytes go from the browser to ImageKit. The browser then sends the small file reference and menu/license fields to Vercel. Vercel verifies the ImageKit file ID, exact staging path, private status, size, MIME type, and one-use Firestore ticket; it downloads the image for the existing Sharp, duplicate, rights, and optional ML checks; then it stores the approved/pending asset and its status in Firestore. Contributor submissions remain pending review, and the existing anonymous contributor route remains available.

The staging upload uses ImageKit Upload API V1 because ImageKit's supported JavaScript SDK documents this browser upload flow. The Vercel endpoint does not trust the browser-supplied file path or file ID; it checks them against ImageKit's server API and the Firestore intent. ImageKit V1's signature covers its token and expiry, not every upload field, so enable an ImageKit folder/path policy for `/acropin-staging/` where available. Vercel rejects any file not found at the expected private staging path and never registers that file as a contribution. A modified browser could still use its one-use V1 authorization for an unregistered upload with altered optional fields; the account-side path policy is the extra control for that case.

## First production migration

The first request that initializes production storage copies the existing JSON data into Firestore: the image catalog, restaurant menus, dataset inventory, GitHub contributor profiles, and separate contributor access decisions. Existing individual contributor records take precedence over the older combined profile file. The original combined file is retained, and blocked accounts keep their status. Dish locks, contributor rate limits, and new uploads already use Firestore when it is configured. The import is idempotent and will not replace a Firestore snapshot that exists without a completed migration marker.

The screenshot from 1 November 2026 shows the Blob store over its Hobby simple-operation allowance and says access resumes **30 November 2026**. Until Vercel restores access, the source files cannot be read. Production startup therefore fails closed for storage-backed APIs; the migration does not substitute the empty local JSON files or report success. Keep the Blob store connected, and do not remove its environment variable or delete the store yet.

After Vercel access resumes, redeploy or make a request to run the one-time JSON import. Then copy old image binaries to ImageKit using the explicit, dry-run-first command from a trusted developer machine with working Blob, Firebase, and ImageKit credentials:

```sh
npm run migrate:food-images:imagekit
npm run migrate:food-images:imagekit -- --apply
```

The first command only lists the planned files. The second copies image files to private ImageKit paths and updates only their matching food image asset documents in Firestore. It never deletes the Blob source. Verify that every old asset has an ImageKit file ID and loads in the production library, and that contributor sign-in, owner review, existing contributions, restaurant menus, and dataset edits work. Only after those checks should the Blob connection be removed. The application retains Firestore and ImageKit as its runtime stores after Blob is disconnected.

If a migration is interrupted after an ImageKit upload but before Firestore is updated, an unused private copy may remain in ImageKit. The legacy source stays intact and the migration can be reviewed and rerun after removing that unused copy in the ImageKit dashboard.

## Local development

Copy `.env.example` to `.env.local`. The old Blob connection is needed only to import/migrate its existing data. To access that private source locally, run `vercel link` and `vercel env pull` from the linked project; do not commit the resulting secrets. Without Firebase or ImageKit, local disk and the existing multipart upload continue to work. Without ImageKit direct-upload configuration, the UI uses the legacy upload endpoint for files up to 3.5 MB. Direct ImageKit uploads accept files up to 15 MB.
