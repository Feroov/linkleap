import { kv as vercelKv } from "@vercel/kv";

// Minimal interface we need
type KV = {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<void>;
};

const hasKvEnv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// In-memory KV for local dev (with optional TTL)
type Entry = { value: unknown; expiresAt?: number };
const g = globalThis as unknown as { __MEMKV?: Map<string, Entry> };
if (!g.__MEMKV) g.__MEMKV = new Map<string, Entry>();
const mem = g.__MEMKV;

const memKv: KV = {
  async get<T = unknown>(key: string): Promise<T | null> {
    const e = mem.get(key);
    if (!e) return null;
    if (e.expiresAt && Date.now() > e.expiresAt) {
      mem.delete(key);
      return null;
    }
    return e.value as T;
  },
  async set(key: string, value: unknown, opts?: { ex?: number }) {
    const entry: Entry = { value };
    if (opts?.ex) entry.expiresAt = Date.now() + opts.ex * 1000;
    mem.set(key, entry);
  },
};

// Use real Upstash KV if env vars exist; otherwise memory
const kv: KV = hasKvEnv ? (vercelKv as unknown as KV) : memKv;
export default kv;
