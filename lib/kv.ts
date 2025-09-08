// lib/kv.ts
import "server-only";
import { createClient } from "redis";

// Minimal surface we actually use (so we don't pull Redis' heavy types)
type RedisBasic = {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    opts?: { EX?: number }
  ): Promise<unknown>;
  del(key: string): Promise<unknown>;
  on(event: "error", listener: (err: unknown) => void): void;
  connect(): Promise<void>;
};

type KV = {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<void>;
  del?(key: string): Promise<number | void>;
};

// Cache one client per runtime
let _client: RedisBasic | null = null;

async function getClient(): Promise<RedisBasic> {
  if (_client) return _client;

  const url = process.env.REDIS_URL;
  if (!url) throw new Error("Missing REDIS_URL env");

  const client = createClient({
    url,
    socket: { connectTimeout: 5000 },
  }) as unknown as RedisBasic;

  client.on("error", (err) => console.error("Redis error", err));
  await client.connect();
  _client = client;
  return _client;
}

const kv: KV = {
  async get<T = unknown>(key: string): Promise<T | null> {
    const client = await getClient();
    const raw = await client.get(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  },

  async set(key: string, value: unknown, opts?: { ex?: number }) {
    const client = await getClient();
    const payload = JSON.stringify(value);
    if (opts?.ex) await client.set(key, payload, { EX: opts.ex });
    else await client.set(key, payload);
  },

  async del(key: string) {
    const client = await getClient();
    await client.del(key);
  },
};

export const KV_BACKEND = "redis-url";
export default kv;
