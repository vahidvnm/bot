/**
 * Runtime-agnostic environment access.
 * - Node (dev / VPS / Docker): falls back to globalThis.process.env
 * - Cloudflare Workers: the worker entry injects its env bindings via setRuntimeEnv()
 */
let overrides: Record<string, string> | null = null;

export function setRuntimeEnv(env: Record<string, unknown>): void {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') flat[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') flat[k] = String(v);
  }
  overrides = flat;
}

export function env(name: string, fallback = ''): string {
  if (overrides) {
    return name in overrides ? overrides[name] : fallback;
  }
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name] ?? fallback;
}
