# Contributing food images

1. Fork this repository and create `packages/food-images/contributions/<unique-kebab-case-slug>/`.
2. Add exactly one original source image in that folder, for example `source.jpg`.
3. Copy `packages/food-images/contributions/_template/metadata.json` to the same folder as `metadata.json`. Fill every required field and replace all placeholders.
4. Run `npm install` once after cloning, then `npm run build:food-images` and `npm run lint` from the repository root.
5. Open a pull request with a title such as `feat(food-images): add margherita pizza photo`. A maintainer reviews ownership, license evidence, attribution, image quality, and duplicate content before merging.

## Rights checklist

- You created the image, or have written, image-specific permission to distribute it in this public package under the selected license.
- The metadata names the creator or rightsholder and links to the source and evidence for that image.
- Set `category` to a useful lowercase value such as `pizza`, `fruit`, `dessert`, or `beverages` so API clients can filter the catalog.
- Choose `CC0-1.0` or `CC-BY-4.0`. For CC-BY, include attribution text that downstream users can display.
- Do not rely on a site's general terms or a URL that merely displays an image. Do not submit Unsplash, Pexels, stock-photo, or scraped images without explicit rights to redistribute them in this catalog.

CI rejects invalid metadata, unsupported license identifiers, duplicate slugs, exact duplicate image files, near-duplicates within 6 bits of the 64-bit DCT perceptual hash, and files that cannot be safely normalized. The perceptual hash is a fast duplicate check; it cannot verify the image's license or prove AI generation. Do not include generated WebP files or edit `dist/`.

## Image quality and framing

- Submit a source with a shortest edge of at least 300 px and a longest edge of at least 480 px. Larger source files produce 960 px and 1600 px variants when available.
- The original source stays in the contribution folder. Generated WebP variants are encoded from that original at quality 92; the pipeline does not re-encode a smaller WebP into larger variants.
- Images keep their full frame and aspect ratio. The pipeline does not crop or enlarge photos. A `480.webp` filename means a maximum edge of 480 px; the actual width and height are recorded in the catalog.
- Output size is allowed to vary with image detail. The pipeline does not lower quality to meet an arbitrary kilobyte target.

The repository maintains an explicit npm install-script allowlist in the root `package.json`: only the lockfile-pinned `esbuild` install script is approved because the TypeScript build tool requires its platform binary. Other discovered dependency scripts remain denied.

After merge, Release Please prepares a versioned release pull request. Merging that release PR publishes the package through npm trusted publishing. The npm package must first be claimed and the repository/workflow configured as a trusted publisher by an npm package owner; see the repository's release setup notes.

## One-time maintainer release setup

1. An npm package owner signs in, then publishes the initial `0.1.0` package from the repository root:

   ```sh
   npm login
   npm run build:food-images
   npm publish --workspace packages/food-images --access public
   ```

2. In npmjs.com, open the `acropin-food-images` package settings and add a GitHub Actions trusted publisher for organization/user `Acropin`, repository `Acropin-SharpVips`, workflow filename `release-food-images.yml`, with direct `npm publish` allowed.
3. Keep the workflow on a GitHub-hosted runner with its `id-token: write` permission. The first OIDC publish must succeed within 2 days after creating the trusted-publisher configuration. npm requires npm CLI 11.5.1+ and Node 22.14+ for trusted publishing; this workflow uses Node 24 and npm 12. npm 12 blocks dependency install scripts unless approved in the root `package.json` allowlist.
4. Enable GitHub Actions to create pull requests and releases for the repository, then merge image contributions using Conventional Commit titles such as `feat(food-images): add margherita pizza`. Release Please opens the release PR; merging it triggers npm publication.

If the package already exists, skip the initial publish and configure the trusted publisher. Do not publish a version that already exists in npm.
