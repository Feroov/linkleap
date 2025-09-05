import kv from "@/lib/kv";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

type LobbyMeta = { code: string; seed: string; status: "waiting"|"playing"; createdAt: number; maxPlayers: number; };
export const dynamic = "force-dynamic";

export default async function Lobbies() {
  const list = (await kv.get<LobbyMeta[]>("lobbies")) ?? [];
  const now = Date.now();
  const lobbies = list
    .filter(l => l.status === "waiting" && now - l.createdAt < 60 * 60 * 1000)
    .sort((a,b) => b.createdAt - a.createdAt);

  return (
    <main className="pt-8">
      <h1 className="text-3xl font-semibold">Join a lobby</h1>
      <div className="mt-4 grid gap-3">
        {lobbies.length === 0 && (
          <Card className="p-4 text-white/70">No open lobbies right now. Ask a friend to host!</Card>
        )}
        {lobbies.map((l) => (
          <Card key={l.code} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-semibold tracking-wider">#{l.code}</div>
              <div className="text-xs text-white/60">
                seed <code>{l.seed}</code> · {Math.round((now - l.createdAt)/1000)}s ago
              </div>
            </div>
            <Link href={`/lobby/${l.code}`}>
              <Button look="accent">Join</Button>
            </Link>
          </Card>
        ))}
      </div>
      <div className="mt-4">
        <Link href="/" className="text-white/70 hover:text-white">← Back</Link>
      </div>
    </main>
  );
}
