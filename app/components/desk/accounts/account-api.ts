/** The account screens' calls to the API. A refusal keeps its status and code, so a screen can respond to it. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || 'Something went wrong.', res.status, body.code);
  return body;
}
