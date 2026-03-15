// src/app/page.tsx
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import Link from "next/link";
import type { Repository } from "@/lib/types";
import DisconnectButton from "@/components/DisconnectButton";
import RepoCard from "@/components/RepoCard";

async function getRepos(): Promise<Repository[]> {
  const cookieStore = await cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data } = await sb.from("repositories").select("*").order("created_at", { ascending: false });
  return (data ?? []) as Repository[];
}

export default async function DashboardPage() {
  const repos = await getRepos();

  return (
    <div style={{ minHeight: "100vh", background: "var(--c0)", fontFamily: "var(--font)" }}>
      {/* Nav */}
      <header style={{ borderBottom: "1px solid var(--cb)", background: "var(--c1)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: "960px", margin: "0 auto", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "28px", height: "28px", borderRadius: "8px", background: "var(--c2)", border: "1px solid var(--cb)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--cg)" }}>&gt;_</span>
            </div>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--ct)" }}>
              <span style={{ color: "var(--cg)" }}>Echo</span>Repo
            </span>
          </div>
          <Link href="/connect" style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "7px 14px", borderRadius: "10px", background: "var(--cg)", color: "var(--c0)", fontSize: "12px", fontWeight: 700, textDecoration: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}>
            + Connect Repo
          </Link>
        </div>
      </header>

      <main style={{ maxWidth: "960px", margin: "0 auto", padding: "40px 24px" }}>
        <div style={{ marginBottom: "28px" }}>
          <h2 style={{ fontSize: "17px", fontWeight: 700, color: "var(--ct)" }}>Repositories</h2>
          <p style={{ fontSize: "11px", color: "var(--cm)", marginTop: "4px" }}>
            {repos.length > 0 ? `${repos.length} connected · click any to start chatting` : "No repositories connected yet"}
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
          {repos.map((repo) => (
            <RepoCard key={repo.id} repo={repo} />
          ))}

          {/* Add repo card */}
          <Link href="/connect" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", borderRadius: "16px", border: "1px dashed var(--cb)", padding: "32px", textDecoration: "none", minHeight: "140px" }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "var(--c2)", border: "1px solid var(--cb)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: "18px", color: "var(--cm)" }}>+</span>
            </div>
            <span style={{ fontSize: "11px", color: "var(--cm)" }}>Connect repository</span>
          </Link>

          {repos.length === 0 && (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "60px 0", color: "var(--cm)", fontSize: "13px" }}>
              No repositories yet —{" "}
              <Link href="/connect" style={{ color: "var(--cg)", textDecoration: "none" }}>connect your first repo</Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}