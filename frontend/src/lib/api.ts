// Cliente HTTP enxuto. Lê JWT do localStorage e injeta no header Authorization.
// Sem dependência externa para evitar payload e tipos pesados.
const API = ''; // mesma origem, proxied via next.config (rewrites) -> backend

function token(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('jwt');
}

interface ReqOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
}

export async function api<T = unknown>(path: string, opts: ReqOpts = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const t = token();
  if (t) headers['authorization'] = `Bearer ${t}`;
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 401 && typeof window !== 'undefined') {
    localStorage.removeItem('jwt');
    if (!path.startsWith('/api/publico') && !location.pathname.startsWith('/login')) {
      location.href = '/login';
    }
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.erro ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const auth = {
  async login(email: string, password: string) {
    const r = await api<{ token: string; user: any }>('/api/login', { method: 'POST', body: { email, password } });
    if (typeof window !== 'undefined') localStorage.setItem('jwt', r.token);
    return r;
  },
  logout() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('jwt');
      location.href = '/login';
    }
  },
  isAuthed() { return !!token(); },
  async me() { return api<any>('/api/me'); },
};
