import { NextResponse } from "next/server";
import { cancelConversionJob, cleanupExpiredJobs, getConversionJob } from "@/lib/conversion-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/api/jobs/[id]">) {
  await cleanupExpiredJobs();

  const { id } = await context.params;
  const job = getConversionJob(id);

  if (!job) {
    return NextResponse.json({ error: "Conversion job was not found." }, { status: 404 });
  }

  return NextResponse.json(job);
}

export async function DELETE(_request: Request, context: RouteContext<"/api/jobs/[id]">) {
  const { id } = await context.params;
  const job = await cancelConversionJob(id);

  if (!job) {
    return NextResponse.json({ error: "Conversion job was not found." }, { status: 404 });
  }

  return NextResponse.json(job);
}
