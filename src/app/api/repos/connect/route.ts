// src/app/api/repos/connect/route.ts
// Handles the full repo connection flow:
// 1. Fetch repo info from GitHub API
// 2. Generate webhook secret
// 3. Insert repo into Supabase
// 4. Register webhook on GitHub

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  // Verify user is authenticated
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Rate limit: 5 connections per user per hour
  const rl = LIMITS.connectRepo(user.id);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait before connecting another repository." },
      { status: 429, headers: { "X-RateLimit-Reset": String(rl.resetAt) } }
    );
  }

  const { repoUrl } = await req.json();
  if (!repoUrl) {
    return NextResponse.json({ error: "Repository URL is required" }, { status: 400 });
  }

  // Parse owner/repo from URL or plain "owner/repo" string
  const fullName = parseRepoInput(repoUrl);
  if (!fullName) {
    return NextResponse.json(
      { error: "Invalid repository. Use format: owner/repo or full GitHub URL" },
      { status: 400 }
    );
  }

  const GITHUB_PAT = process.env.GITHUB_PAT!;
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  // ── 1. Fetch repo info from GitHub API ──
  const githubRes = await fetch(`https://api.github.com/repos/${fullName}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_PAT}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (githubRes.status === 404) {
    return NextResponse.json(
      { error: "Repository not found or you don't have access to it" },
      { status: 404 }
    );
  }
  if (!githubRes.ok) {
    return NextResponse.json(
      { error: "Failed to fetch repository from GitHub" },
      { status: 502 }
    );
  }

  const githubRepo = await githubRes.json();

  // ── 2. Check if repo is already connected ──
  const serviceSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [] } }
  );

  const { data: existing } = await serviceSupabase
    .from("repositories")
    .select("id")
    .eq("github_id", githubRepo.id)
    .single();

  if (existing) {
    return NextResponse.json(
      { error: "This repository is already connected" },
      { status: 409 }
    );
  }

  // ── 3. Generate webhook secret ──
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const webhookSecret = Array.from(secretBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // ── 4. Insert repo into Supabase ──
  const { data: newRepo, error: insertError } = await serviceSupabase
    .from("repositories")
    .insert({
      owner_id: user.id,
      github_id: githubRepo.id,
      full_name: githubRepo.full_name,
      default_branch: githubRepo.default_branch,
      webhook_secret: webhookSecret,
    })
    .select()
    .single();

  if (insertError) {
    console.error("Insert error:", insertError);
    return NextResponse.json({ error: "Failed to save repository" }, { status: 500 });
  }

  // ── 5. Register webhook on GitHub ──
  const webhookUrl = `${SUPABASE_URL}/functions/v1/github-webhook`;

  const webhookRes = await fetch(
    `https://api.github.com/repos/${fullName}/hooks`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GITHUB_PAT}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "web",
        active: true,
        events: ["push", "pull_request"],
        config: {
          url: webhookUrl,
          content_type: "json",
          secret: webhookSecret,
          insecure_ssl: "0",
        },
      }),
    }
  );

  if (!webhookRes.ok) {
    const webhookErr = await webhookRes.json();
    // Webhook registration failed — clean up the DB row
    await serviceSupabase.from("repositories").delete().eq("id", newRepo.id);

    const message = webhookErr.message ?? "Failed to register webhook";
    // Common case: token doesn't have admin:repo_hooks scope
    if (webhookRes.status === 403) {
      return NextResponse.json(
        { error: `GitHub webhook registration failed: ${message}. Make sure your GitHub PAT has the 'repo' scope.` },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: `Webhook error: ${message}` }, { status: 502 });
  }

  const webhook = await webhookRes.json();

  // Kick off initial full sync in the background (non-blocking)
  // Uses waitUntil if available, otherwise fire-and-forget
  const syncUrl = `${req.nextUrl.origin}/api/repos/sync`;
  fetch(syncUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Forward the auth cookie so the sync route can verify the user
      Cookie: req.headers.get("cookie") ?? "",
    },
    body: JSON.stringify({ repoId: newRepo.id }),
  }).catch((err) => console.error("Background sync failed:", err));

  return NextResponse.json({
    success: true,
    repo: {
      id: newRepo.id,
      fullName: githubRepo.full_name,
      defaultBranch: githubRepo.default_branch,
      private: githubRepo.private,
      description: githubRepo.description,
      webhookId: webhook.id,
    },
  });
}

// ── Helper: parse various repo input formats ──
function parseRepoInput(input: string): string | null {
  input = input.trim();
  // Full URL: https://github.com/owner/repo or https://github.com/owner/repo.git
  const urlMatch = input.match(/github\.com\/([^/]+\/[^/\s]+?)(?:\.git)?(?:\/.*)?$/);
  if (urlMatch) return urlMatch[1];
  // Plain owner/repo
  const plainMatch = input.match(/^([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)$/);
  if (plainMatch) return plainMatch[1];
  return null;
}
