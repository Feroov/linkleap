"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Home() {
  const r = useRouter();
  const [busy, setBusy] = useState(false);

  async function hostLobby() {
    setBusy(true);
    try {
      const res = await fetch("/api/lobby", { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new Error(await res.text());
      const meta = await res.json();
      r.push(`/lobby/${meta.code}?host=1`);
    } catch (e) { alert(String(e)); } finally { setBusy(false); }
  }

  return (
    <main style={{ paddingTop: 24 }}>
      <h1 style={{ fontSize: 48, marginBottom: 8 }}>LinkLeap</h1>
      <p style={{ opacity: 0.8, marginBottom: 24 }}>Two minds. One leap. Procedural co-op platforming.</p>
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={hostLobby} disabled={busy}
          style={{ padding: "14px 18px", borderRadius: 12, border: "1px solid #444", background: "#1a1d24", color: "white" }}>
          {busy ? "Creating…" : "Host lobby"}
        </button>
        <button onClick={() => r.push("/lobbies")}
          style={{ padding: "14px 18px", borderRadius: 12, border: "1px solid #444", background: "#14161c", color: "white" }}>
          Join lobby
        </button>
      </div>
    </main>
  );
}
