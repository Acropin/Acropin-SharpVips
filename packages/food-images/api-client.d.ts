export type FoodImageApiSize = 128 | 480 | 960 | 1600;

export interface FoodImageApiVariant {
  url: string;
  width: number;
  height: number;
  format: 'webp' | 'auto';
  /** Exact bytes are known for legacy stored variants, but generated master transforms are size-dependent. */
  byteSize?: number;
}

export interface ApiFoodImage {
  slug: string;
  dishName: string;
  canonicalDishId: string | null;
  category: string;
  creator: string;
  tags: string[];
  license: 'CC0-1.0' | 'CC-BY-4.0';
  attribution: string | null;
  sourceUrl: string | null;
  licenseEvidenceUrl: string | null;
  variants: Partial<Record<FoodImageApiSize, FoodImageApiVariant>>;
}

export interface FoodImageCatalogOptions {
  search?: string;
  category?: string;
  dishId?: string;
  limit?: number;
  offset?: number;
}

export interface FoodImageCatalogResult {
  assets: ApiFoodImage[];
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
  contact: string;
}

export interface FoodImageClientOptions {
  /** Cloudflare Worker API origin, without an /api/v1 path. */
  baseUrl: string;
  /** A free customer key issued by the maintainer. Do not use an owner key here. */
  apiKey: string;
  /** Optional Fetch-compatible implementation, useful for tests and server runtimes. */
  fetch?: typeof fetch;
}

export declare class FoodImageApiError extends Error {
  constructor(message: string, options: { status?: number; retryAfterSeconds?: number; contact?: string });
  status?: number;
  retryAfterSeconds?: number;
  contact?: string;
}

export declare class AcropinFoodImagesClient {
  constructor(options: FoodImageClientOptions);
  list(options?: FoodImageCatalogOptions): Promise<FoodImageCatalogResult>;
  search(search: string, options?: Omit<FoodImageCatalogOptions, 'search'>): Promise<FoodImageCatalogResult>;
  get(slug: string): Promise<ApiFoodImage | undefined>;
  health(): Promise<{ ok: boolean; service: string; contact: string }>;
}

export declare function createFoodImageClient(options: FoodImageClientOptions): AcropinFoodImagesClient;
