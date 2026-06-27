import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

type ConversionMode = "single" | "playlist";

function isYouTubeUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");

    return hostname === "youtube.com" || hostname === "youtu.be" || hostname.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

function getYtDlpCommand() {
  if (process.env.YT_DLP_PATH) {
    return process.env.YT_DLP_PATH;
  }

  return process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
}

function getFfmpegLocation() {
  return process.env.FFMPEG_PATH;
}

function getDenoLocation() {
  return process.env.DENO_PATH;
}

function getCookiesPath() {
  return process.env.YT_COOKIES_PATH;
}

function getSafeHeaderFilename(filename: string) {
  return filename.replace(/["\\\r\n]/g, "").replace(/[^\x20-\x7E]/g, "_");
}

function getContentDisposition(filename: string) {
  const safeFilename = getSafeHeaderFilename(filename);

  return `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function toResponseBody(buffer: Buffer) {
  return new Uint8Array(buffer);
}

async function findMp3Files(tempDir: string) {
  const mp3Files: string[] = [];

  async function walk(directory: string) {
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".mp3")) {
        mp3Files.push(entryPath);
      }
    }
  }

  await walk(tempDir);

  return mp3Files.sort((a, b) => a.localeCompare(b));
}

async function createPlaylistZip(mp3Paths: string[], tempDir: string) {
  const zip = new JSZip();

  for (const mp3Path of mp3Paths) {
    const relativePath = path.relative(tempDir, mp3Path).replaceAll(path.sep, "/");
    zip.file(relativePath, await fs.readFile(mp3Path));
  }

  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}

function runConversion(url: string, outputTemplate: string, mode: ConversionMode) {
  const ffmpegLocation = getFfmpegLocation();
  const denoLocation = getDenoLocation();
  const cookiesPath = getCookiesPath();
  const args = [
    url,
    "--extract-audio",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "--restrict-filenames",
    "--output",
    outputTemplate,
  ];

  if (mode === "single") {
    args.push("--no-playlist");
  } else {
    args.push("--yes-playlist", "--ignore-errors");
  }

  if (ffmpegLocation) {
    args.push("--ffmpeg-location", ffmpegLocation);
  }

  if (denoLocation) {
    args.push("--js-runtimes", `deno:${denoLocation}`);
  }

  if (cookiesPath) {
    args.push("--cookies", cookiesPath);
  }

  return new Promise<{ success: boolean; output?: string; error?: string }>((resolve) => {
    execFile(
      getYtDlpCommand(),
      args,
      {
        maxBuffer: 1024 * 1024 * 10,
        timeout: 1000 * 60 * 30,
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            success: false,
            error:
              stderr?.trim() ||
              stdout?.trim() ||
              "The conversion failed. Make sure yt-dlp and ffmpeg are installed on the server.",
          });
          return;
        }

        resolve({ success: true, output: stdout.trim() || stderr.trim() });
      }
    );
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";
    const mode: ConversionMode = body?.mode === "playlist" ? "playlist" : "single";

    if (!rawUrl) {
      return NextResponse.json(
        { error: "Please paste a YouTube URL to continue." },
        { status: 400 }
      );
    }

    if (!isYouTubeUrl(rawUrl)) {
      return NextResponse.json(
        { error: "Only YouTube links are supported in this experimental build." },
        { status: 400 }
      );
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ytmp3-"));
    const outputTemplate =
      mode === "playlist"
        ? path.join(tempDir, "%(playlist_index|00)s - %(title).200B.%(ext)s")
        : path.join(tempDir, "%(title).200B.%(ext)s");
    const result = await runConversion(rawUrl, outputTemplate, mode);
    const mp3Paths = await findMp3Files(tempDir);

    if (!result.success || mp3Paths.length === 0) {
      await fs.rm(tempDir, { recursive: true, force: true });
      return NextResponse.json(
        {
          error:
            result.error ||
            "Conversion failed. Check that yt-dlp and ffmpeg are installed and that the video is accessible.",
        },
        { status: 500 }
      );
    }

    if (mode === "playlist") {
      const zipBuffer = await createPlaylistZip(mp3Paths, tempDir);
      await fs.rm(tempDir, { recursive: true, force: true });

      return new NextResponse(toResponseBody(zipBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": getContentDisposition("youtube-playlist-mp3.zip"),
          "Cache-Control": "no-store",
        },
      });
    }

    const mp3Path = mp3Paths[0];
    const fileBuffer = await fs.readFile(mp3Path);
    const filename = path.basename(mp3Path);
    await fs.rm(tempDir, { recursive: true, force: true });

    return new NextResponse(toResponseBody(fileBuffer), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": getContentDisposition(filename),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "The server could not process the request." },
      { status: 500 }
    );
  }
}
