import kv from "@/lib/kv";

export const runtime = "nodejs"; // ensure this runs on Node (not Edge)

export async function GET() {
  // Detect which backend *should* be active from envs
  const hasVercelKV =
    Boolean(process.env.KV_REST_API_URL) &&
    Boolean(process.env.KV_REST_API_TOKEN);

  const hasUpstash =
    Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
    Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);

  const backend = hasVercelKV ? "vercel-kv" : hasUpstash ? "upstash" : "memory";

  try {
    // Our kv.set stores JSON strings; reading returns the parsed value
    await kv.set("diag:ping", "ok", { ex: 30 });
    const got = await kv.get<string>("diag:ping");

    return Response.json({
      backendEnvDetected: backend,   // which envs we detected
      kvWorks: got === "ok",         // did a roundtrip succeed?
      valueReadBack: got,            // should be "ok"
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        backendEnvDetected: backend,
        kvWorks: false,
        error: String(e),
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}
