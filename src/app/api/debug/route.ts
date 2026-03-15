// src/app/api/debug/route.ts
// DELETE THIS FILE BEFORE DEPLOYING TO PRODUCTION

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "MISSING",
    anonKeyPrefix: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.slice(0, 20) ?? "MISSING",
    serviceKeyPrefix: process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 20) ?? "MISSING",
    githubPat: process.env.GITHUB_PAT ? "SET" : "MISSING",
    hfToken: process.env.HF_TOKEN ? "SET" : "MISSING",
    openaiKey: process.env.OPENAI_API_KEY ? "SET" : "MISSING",
  });
}