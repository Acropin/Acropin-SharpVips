/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const ADMIN_TOKEN_KEY = 'acropin-admin-token';

/** Retrieves current session admin token */
export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Updates session admin token */
export function setAdminToken(token: string | null): void {
  try {
    if (token && token.trim()) {
      sessionStorage.setItem(ADMIN_TOKEN_KEY, token.trim());
    } else {
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    }
  } catch {
    // Session storage may be unavailable in restricted contexts
  }
}

/** Checks whether admin token is set */
export function isAdminAuthenticated(): boolean {
  return Boolean(getAdminToken());
}

/** Sends API requests with the session's admin token when one is available. */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = getAdminToken();

  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) {
    setAdminToken(null);
  }
  return response;
}
