/** Typed-at-runtime-free JavaScript client for the Acropin Food Images API. */
export class FoodImageApiError extends Error {
  constructor(message, { status, retryAfterSeconds, contact }) {
    super(message);
    this.name = 'FoodImageApiError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.contact = contact;
  }
}

export class AcropinFoodImagesClient {
  #baseUrl;
  #apiKey;
  #fetch;

  constructor({ baseUrl, apiKey, fetch: fetchImplementation = globalThis.fetch }) {
    if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
      throw new TypeError('baseUrl is required.');
    }
    const parsedBaseUrl = new URL(baseUrl);
    if (parsedBaseUrl.protocol !== 'https:' && parsedBaseUrl.hostname !== 'localhost') {
      throw new TypeError('baseUrl must use HTTPS.');
    }
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new TypeError('apiKey is required.');
    }
    if (typeof fetchImplementation !== 'function') {
      throw new TypeError('A Fetch API implementation is required.');
    }

    this.#baseUrl = parsedBaseUrl.toString().replace(/\/$/u, '');
    this.#apiKey = apiKey.trim();
    this.#fetch = fetchImplementation;
  }

  async #request(path) {
    const response = await this.#fetch(new URL(path, `${this.#baseUrl}/`), {
      headers: { Authorization: `Bearer ${this.#apiKey}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof payload?.error === 'string' ? payload.error : `API request failed (${response.status}).`;
      throw new FoodImageApiError(message, {
        status: response.status,
        retryAfterSeconds: Number(payload?.retryAfterSeconds) || undefined,
        contact: typeof payload?.contact === 'string' ? payload.contact : undefined,
      });
    }
    return payload;
  }

  async list({ search, category, dishId, limit, offset } = {}) {
    const query = new URLSearchParams();
    if (search) query.set('search', search);
    if (category) query.set('category', category);
    if (dishId) query.set('dishId', dishId);
    if (limit !== undefined) query.set('limit', String(limit));
    if (offset !== undefined) query.set('offset', String(offset));
    const suffix = query.size ? `?${query}` : '';
    return this.#request(`/api/v1/catalog${suffix}`);
  }

  async search(search, options = {}) {
    return this.list({ ...options, search });
  }

  async get(slug) {
    if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
      throw new TypeError('slug must be a lowercase kebab-case food image slug.');
    }
    try {
      const result = await this.#request(`/api/v1/catalog/${encodeURIComponent(slug)}`);
      return result.assets?.[0];
    } catch (error) {
      if (error instanceof FoodImageApiError && error.status === 404) return undefined;
      throw error;
    }
  }

  async health() {
    const response = await this.#fetch(new URL('/api/v1/health', `${this.#baseUrl}/`));
    if (!response.ok) throw new FoodImageApiError(`API health check failed (${response.status}).`, { status: response.status });
    return response.json();
  }
}

export function createFoodImageClient(options) {
  return new AcropinFoodImagesClient(options);
}
