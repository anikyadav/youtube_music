import { NextRequest, NextResponse } from "next/server";
import {
  cleanupExpiredJobs,
  createConversionJob,
  normalizeAudioQuality,
  type AudioQuality,
  type ConversionMode,
} from "@/lib/conversion-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

function isYouTubeUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");

    return hostname === "youtube.com" || hostname === "youtu.be" || hostname.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  await cleanupExpiredJobs();

  const body = await request.json().catch(() => null);
  const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";
  const mode: ConversionMode = body?.mode === "playlist" ? "playlist" : "single";
  const quality: AudioQuality | undefined =
    typeof body?.quality === "undefined" ? undefined : normalizeAudioQuality(body.quality);

  if (!rawUrl) {
    return NextResponse.json({ error: "Please paste a YouTube URL to continue." }, { status: 400 });
  }

  if (!isYouTubeUrl(rawUrl)) {
    return NextResponse.json(
      { error: "Only YouTube links are supported in this experimental build." },
      { status: 400 }
    );
  }

  const job = await createConversionJob({ url: rawUrl, mode, quality });

  return NextResponse.json(job, { status: 202 });
}
