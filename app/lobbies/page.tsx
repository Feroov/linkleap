import kv from "@/lib/kv";
import Link from "next/link";

type LobbyMeta = { code: string; seed: string; status: "waiting"|"playing"; createdAt: number; maxPlayers: number; };
export const dynamic = "force-dynamic";

export default async function Lobbies() {
  const list = (await kv.get<LobbyMeta[]>("lobbies")) ?? [];
  const now = Date.now();
  const lobbies = list
    .filter(l => l.status === "waiting" && now - l.createdAt < 60*60*1000)
    .sort((a,b) => b.createdAt - a.createdAt);

  return (
    <main style={{ paddingTop: 24 }}>
      <h1 style={{ fontSize: 32, marginBottom: 16 }}>Join a lobby</h1>
      <div style={{ display: "grid", gap: 10 }}>
        {lobbies.length === 0 && <p style={{ opacity: 0.7 }}>No open lobbies right now. Ask a friend to host!</p>}
        {lobbies.map((l) => (
          <div key={l.code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "12px 14px", background: "#14161c", border: "1px solid #2a2d35", borderRadius: 12 }}>
            <div>
              <div style={{ fontWeight: 600, letterSpacing: 1 }}>#{l.code}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>seed <code>{l.seed}</code> · {Math.round((now-l.createdAt)/1000)}s ago</div>
            </div>
            <Link href={`/lobby/${l.code}`} style={{ padding: "8px 12px", borderRadius: 8, background: "#1a1d24", border: "1px solid #3a3f4a" }}>
              Join
            </Link>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16 }}>
        <Link href="/" style={{ opacity: 0.8 }}>← Back</Link>
      </div>
    </main>
  );
}
