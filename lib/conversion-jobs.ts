import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";

export type ConversionMode = "single" | "playlist";
export type JobStatus = "queued" | "running" | "complete" | "error" | "cancelled";

export type ConversionJobSnapshot = {
  id: string;
  mode: ConversionMode;
  status: JobStatus;
  progress: number;
  stage: string;
  message: string;
  currentItem?: string;
  playlistPosition?: number;
  playlistTotal?: number;
  filename?: string;
  size?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

type ConversionJob = ConversionJobSnapshot & {
  tempDir: string;
  outputPath?: string;
  contentType?: string;
  process?: ChildProcessWithoutNullStreams;
};

type CreateJobInput = {
  mode: ConversionMode;
  url: string;
};

const jobs = new Map<string, ConversionJob>();
const JOB_TTL_MS = 1000 * 60 * 30;

function getYtDlpCommand() {
  return process.env.YT_DLP_PATH || (process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
}

function getBaseArgs(url: string, outputTemplate: string, mode: ConversionMode, cookiesPath?: string) {
  const args = [
    url,
    "--extract-audio",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "--restrict-filenames",
    "--newline",
    "--output",
    outputTemplate,
  ];

  if (mode === "single") {
    args.push("--no-playlist");
  } else {
    args.push("--yes-playlist", "--ignore-errors");
  }

  if (process.env.FFMPEG_PATH) {
    args.push("--ffmpeg-location", process.env.FFMPEG_PATH);
  }

  if (process.env.DENO_PATH) {
    args.push("--js-runtimes", `deno:${process.env.DENO_PATH}`);
  }

  if (cookiesPath) {
    args.push("--cookies", cookiesPath);
  }

  return args;
}

async function prepareCookiesFile(tempDir: string) {
  if (!process.env.YT_COOKIES_PATH) {
    return undefined;
  }

  const cookiesPath = path.join(tempDir, "cookies.txt");
  await fs.copyFile(process.env.YT_COOKIES_PATH, cookiesPath);

  return cookiesPath;
}

function getSafeHeaderFilename(filename: string) {
  return filename.replace(/["\\\r\n]/g, "").replace(/[^\x20-\x7E]/g, "_");
}

export function getContentDisposition(filename: string) {
  const safeFilename = getSafeHeaderFilename(filename);

  return `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function toSnapshot(job: ConversionJob): ConversionJobSnapshot {
  const {
    id,
    mode,
    status,
    progress,
    stage,
    message,
    currentItem,
    playlistPosition,
    playlistTotal,
    filename,
    size,
    error,
    createdAt,
    updatedAt,
  } = job;

  return {
    id,
    mode,
    status,
    progress,
    stage,
    message,
    currentItem,
    playlistPosition,
    playlistTotal,
    filename,
    size,
    error,
    createdAt,
    updatedAt,
  };
}

function updateJob(job: ConversionJob, patch: Partial<ConversionJob>) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
}

function extractPercent(line: string) {
  const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);

  return match ? Number(match[1]) : null;
}

function applyProgressLine(job: ConversionJob, line: string) {
  if (!line.trim() || job.status !== "running") {
    return;
  }

  const itemMatch = line.match(/Downloading item\s+(\d+)\s+of\s+(\d+)/i);
  if (itemMatch) {
    const playlistPosition = Number(itemMatch[1]);
    const playlistTotal = Number(itemMatch[2]);
    updateJob(job, {
      playlistPosition,
      playlistTotal,
      stage: "Downloading playlist",
      message: `Downloading item ${playlistPosition} of ${playlistTotal}.`,
      progress: Math.max(job.progress, 5),
    });
    return;
  }

  const destinationMatch = line.match(/Destination:\s+(.+)$/i);
  if (destinationMatch) {
    updateJob(job, {
      currentItem: path.basename(destinationMatch[1]),
      message: `Saving ${path.basename(destinationMatch[1])}.`,
    });
    return;
  }

  const percent = extractPercent(line);
  if (percent !== null) {
    const playlistBase =
      job.mode === "playlist" && job.playlistTotal && job.playlistPosition
        ? ((job.playlistPosition - 1) / job.playlistTotal) * 75
        : 0;
    const playlistShare =
      job.mode === "playlist" && job.playlistTotal ? percent / job.playlistTotal : percent;
    const progress = job.mode === "playlist" ? Math.min(80, 5 + playlistBase + playlistShare * 0.75) : 5 + percent * 0.75;

    updateJob(job, {
      progress: Math.min(85, Math.round(progress)),
      stage: "Downloading audio",
      message: `${percent.toFixed(percent % 1 === 0 ? 0 : 1)}% downloaded.`,
    });
    return;
  }

  if (line.includes("[ExtractAudio]")) {
    updateJob(job, {
      progress: Math.max(job.progress, 86),
      stage: "Encoding MP3",
      message: "Converting audio to MP3.",
    });
    return;
  }

  if (line.includes("[download] Finished")) {
    updateJob(job, {
      progress: Math.max(job.progress, 82),
      message: "Download finished. Preparing audio.",
    });
  }
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

async function finishJob(job: ConversionJob) {
  updateJob(job, {
    progress: Math.max(job.progress, 90),
    stage: job.mode === "playlist" ? "Packaging ZIP" : "Finalizing",
    message: job.mode === "playlist" ? "Packaging converted MP3 files." : "Preparing download.",
  });

  const mp3Paths = await findMp3Files(job.tempDir);

  if (mp3Paths.length === 0) {
    throw new Error("Conversion finished, but no MP3 file was produced.");
  }

  if (job.mode === "playlist") {
    const zipBuffer = await createPlaylistZip(mp3Paths, job.tempDir);
    const outputPath = path.join(job.tempDir, "youtube-playlist-mp3.zip");
    await fs.writeFile(outputPath, zipBuffer);
    const stat = await fs.stat(outputPath);

    updateJob(job, {
      status: "complete",
      progress: 100,
      stage: "Complete",
      message: `Playlist ZIP ready with ${mp3Paths.length} MP3 file${mp3Paths.length === 1 ? "" : "s"}.`,
      outputPath,
      filename: "youtube-playlist-mp3.zip",
      contentType: "application/zip",
      size: stat.size,
    });
    return;
  }

  const outputPath = mp3Paths[0];
  const stat = await fs.stat(outputPath);

  updateJob(job, {
    status: "complete",
    progress: 100,
    stage: "Complete",
    message: "MP3 ready.",
    outputPath,
    filename: path.basename(outputPath),
    contentType: "audio/mpeg",
    size: stat.size,
  });
}

async function runJob(job: ConversionJob, url: string) {
  const outputTemplate =
    job.mode === "playlist"
      ? path.join(job.tempDir, "%(playlist_index|00)s - %(title).200B.%(ext)s")
      : path.join(job.tempDir, "%(title).200B.%(ext)s");
  const cookiesPath = await prepareCookiesFile(job.tempDir);
  const args = getBaseArgs(url, outputTemplate, job.mode, cookiesPath);

  updateJob(job, {
    status: "running",
    progress: 3,
    stage: "Starting",
    message: "Starting yt-dlp.",
  });

  await new Promise<void>((resolve, reject) => {
    const child = spawn(getYtDlpCommand(), args, {
      windowsHide: true,
    });
    let stderr = "";
    let stdout = "";

    updateJob(job, { process: child });

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      text.split(/\r?\n/).forEach((line) => applyProgressLine(job, line));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      text.split(/\r?\n/).forEach((line) => applyProgressLine(job, line));
    });

    child.on("error", reject);

    child.on("close", (code) => {
      updateJob(job, { process: undefined });

      if (job.status === "cancelled") {
        resolve();
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || "Conversion failed."));
    });
  });

  if (job.status !== "cancelled") {
    await finishJob(job);
  }
}

async function cleanupJob(job: ConversionJob) {
  await fs.rm(job.tempDir, { recursive: true, force: true }).catch(() => undefined);
}

export async function createConversionJob(input: CreateJobInput) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ytmp3-job-"));
  const now = new Date().toISOString();
  const job: ConversionJob = {
    id: crypto.randomUUID(),
    mode: input.mode,
    status: "queued",
    progress: 0,
    stage: "Queued",
    message: "Waiting to start.",
    createdAt: now,
    updatedAt: now,
    tempDir,
  };

  jobs.set(job.id, job);
  void runJob(job, input.url).catch(async (error: unknown) => {
    if (job.status === "cancelled") {
      await cleanupJob(job);
      return;
    }

    updateJob(job, {
      status: "error",
      progress: 0,
      stage: "Failed",
      message: "Conversion failed.",
      error: error instanceof Error ? error.message : "Conversion failed.",
    });
    await cleanupJob(job);
  });

  return toSnapshot(job);
}

export function getConversionJob(id: string) {
  const job = jobs.get(id);

  return job ? toSnapshot(job) : null;
}

export async function cancelConversionJob(id: string) {
  const job = jobs.get(id);

  if (!job) {
    return null;
  }

  if (job.status === "complete" || job.status === "error" || job.status === "cancelled") {
    return toSnapshot(job);
  }

  updateJob(job, {
    status: "cancelled",
    progress: 0,
    stage: "Cancelled",
    message: "Conversion cancelled.",
  });
  job.process?.kill("SIGTERM");
  await cleanupJob(job);

  return toSnapshot(job);
}

export async function readConversionDownload(id: string) {
  const job = jobs.get(id);

  if (!job || job.status !== "complete" || !job.outputPath || !job.filename || !job.contentType) {
    return null;
  }

  const buffer = await fs.readFile(job.outputPath);

  return {
    body: new Uint8Array(buffer),
    contentType: job.contentType,
    filename: job.filename,
  };
}

export async function cleanupExpiredJobs() {
  const now = Date.now();

  for (const job of jobs.values()) {
    const updatedAt = Date.parse(job.updatedAt);
    if (Number.isFinite(updatedAt) && now - updatedAt > JOB_TTL_MS) {
      job.process?.kill("SIGTERM");
      await cleanupJob(job);
      jobs.delete(job.id);
    }
  }
}
