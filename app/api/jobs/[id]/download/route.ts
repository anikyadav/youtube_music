import { NextResponse } from "next/server";
import { getContentDisposition, readConversionDownload } from "@/lib/conversion-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/api/jobs/[id]/download">) {
  const { id } = await context.params;
  const download = await readConversionDownload(id);

  if (!download) {
    return NextResponse.json({ error: "Conversion download is not ready." }, { status: 404 });
  }

  return new NextResponse(download.body, {
    status: 200,
    headers: {
      "Content-Type": download.contentType,
      "Content-Disposition": getContentDisposition(download.filename),
      "Cache-Control": "no-store",
    },
  });
}
