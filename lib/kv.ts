import { kv as vercelKv } from "@vercel/kv";
import { Redis as UpstashRedis } from "@upstash/redis";

// Minimal KV interface we use everywhere
type KV = {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<void>;
  del?(key: string): Promise<number | void>;
};

// Which envs do we have?
const HAS_VERCEL_KV =
  Boolean(process.env.KV_REST_API_URL) && Boolean(process.env.KV_REST_API_TOKEN);
const HAS_UPSTASH =
  Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
  Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);

// ---------- In-memory fallback for local dev (with TTL) ----------
type Entry = { value: unknown; expiresAt?: number };
const g = globalThis as unknown as { __MEMKV?: Map<string, Entry> };
g.__MEMKV ??= new Map<string, Entry>();
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
  async del(key: string) {
    mem.delete(key);
  },
};

// ---------- Choose the real backend if available ----------
let kv: KV;

if (HAS_VERCEL_KV) {
  // Vercel KV (will read KV_REST_API_URL/TOKEN)
  kv = vercelKv as unknown as KV;
} else if (HAS_UPSTASH) {
  // Upstash Redis via REST (uses UPSTASH_REDIS_REST_URL/TOKEN)
  const redis = new UpstashRedis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });

  kv = {
    async get<T = unknown>(key: string): Promise<T | null> {
      // We store JSON strings, so read string and JSON.parse
      const raw = await redis.get<string>(key);
      if (typeof raw !== "string") return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },

    async set(key: string, value: unknown, opts?: { ex?: number }): Promise<void> {
      const payload = JSON.stringify(value);
      if (opts?.ex) {
        await redis.set(key, payload, { ex: opts.ex }); // seconds
      } else {
        await redis.set(key, payload);
      }
    },

    async del(key: string): Promise<void> {
      await redis.del(key);
    },
  };
} else {
  // Local/dev fallback
  kv = memKv;
}

export default kv;
