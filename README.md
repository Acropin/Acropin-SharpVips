# Restaurant Menu Item Library

A shared library of reviewed food images for restaurant menus and food apps.

### How it works

<img width="1536" height="1024" alt="food_flowchart_q95" src="https://github.com/user-attachments/assets/5e562aa7-f316-4b0c-bb1d-ebbcd99e8c34" />

### Diagram description

A contributor submits a food image. The system optimizes it and checks for duplicates. A maintainer reviews the image and its rights. Once the pull request is approved and merged, apps can get the image from the npm package or API.

### Why this library exists

- Restaurants often struggle to find good images for their menu items.
- Contributors can help build one shared catalog of food images.
- Apps can reuse optimized images instead of each restaurant storing its own copies.
- Review and duplicate checks help keep the catalog useful and responsibly sourced.

### Using the library

- Install the package with `npm install acropin-food-images`.
- Or contact the owner to request an API key for the food image API.
- Use only approved images from the shared library.

### Contributor recognition

> [!IMPORTANT]
> **Want to contribute? Help us grow the library by submitting a high-quality image for a dish that is missing. Open a GitHub pull request, and only contribute images you created or have permission to share.**

The monthly leaderboard recognizes the top three contributors:

1. **Gold Chef** — first place
2. **Silver Chef** — second place
3. **Bronze Chef** — third place

Approved images earn points. Pending, rejected, revoked, or duplicate submissions do not. These are recognition badges, not cash rewards.

> Dashboard uploads are reviewed separately. They do not automatically publish an image to the npm package or API; the shared-library publishing flow uses a reviewed GitHub pull request.
