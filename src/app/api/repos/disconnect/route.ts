// src/app/api/repos/disconnect/route.ts
// Removes a repo: deletes webhook from GitHub, removes DB row (cascades to documents/sessions)

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { repoId } = await req.json();
  const GITHUB_PAT = process.env.GITHUB_PAT!;

  const serviceSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [] } }
  );

  // Fetch repo (RLS ensures user owns it via owner_id check below)
  const { data: repo } = await serviceSupabase
    .from("repositories")
    .select("id, full_name, owner_id")
    .eq("id", repoId)
    .single();

  if (!repo || repo.owner_id !== user.id) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  // Delete all EchoRepo webhooks from GitHub
  const hooksRes = await fetch(
    `https://api.github.com/repos/${repo.full_name}/hooks`,
    { headers: { Authorization: `Bearer ${GITHUB_PAT}`, Accept: "application/vnd.github.v3+json" } }
  );
  if (hooksRes.ok) {
    const hooks = await hooksRes.json();
    const echoHooks = hooks.filter((h: { config: { url: string } }) =>
      h.config.url?.includes("github-webhook")
    );
    await Promise.allSettled(
      echoHooks.map((h: { id: number }) =>
        fetch(`https://api.github.com/repos/${repo.full_name}/hooks/${h.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${GITHUB_PAT}` },
        })
      )
    );
  }

  // Delete from DB — cascades to documents, chat_sessions, chat_messages
  await serviceSupabase.from("repositories").delete().eq("id", repoId);

  return NextResponse.json({ success: true });
}
