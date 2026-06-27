"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type ConversionStatus = "idle" | "converting" | "complete" | "error";
type ConversionMode = "single" | "playlist";

type JobSnapshot = {
  id: string;
  mode: ConversionMode;
  status: "queued" | "running" | "complete" | "error" | "cancelled";
  progress: number;
  stage: string;
  message: string;
  currentItem?: string;
  playlistPosition?: number;
  playlistTotal?: number;
  filename?: string;
  size?: number;
  error?: string;
};

type DownloadState = {
  href: string;
  filename: string;
  size: number;
};

function DownloadIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none">
      <path
        d="M10 13a5 5 0 0 0 7.07 0l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15M14 11a5 5 0 0 0-7.07 0l-2 2A5 5 0 0 0 12 20.07l1.15-1.15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none">
      <path
        d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none">
      <path
        d="M9 5h6m-5 0a2 2 0 0 1 4 0m-7 2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1M9 5H8a2 2 0 0 0-2 2m9-2h1a2 2 0 0 1 2 2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function getFilename(response: Response) {
  const disposition = response.headers.get("Content-Disposition");
  const encodedMatch = disposition?.match(/filename\*=UTF-8''([^;]+)/i);

  if (encodedMatch?.[1]) {
    return decodeURIComponent(encodedMatch[1]);
  }

  const match = disposition?.match(/filename="?([^"]+)"?/i);

  return match?.[1] || "audio.mp3";
}

function triggerDownload(href: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<ConversionMode>("single");
  const [status, setStatus] = useState<ConversionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [download, setDownload] = useState<DownloadState | null>(null);
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [downloadedJobId, setDownloadedJobId] = useState<string | null>(null);
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);

  const canSubmit = useMemo(() => url.trim().length > 0 && status !== "converting", [status, url]);
  const activeJobId = job?.id;

  useEffect(() => {
    return () => {
      if (download?.href) {
        window.URL.revokeObjectURL(download.href);
      }
    };
  }, [download?.href]);

  useEffect(() => {
    if (!activeJobId || status !== "converting") {
      return;
    }

    let cancelled = false;

    async function pollJob() {
      if (cancelled) {
        return;
      }

      try {
        const response = await fetch(`/api/jobs/${activeJobId}`, { cache: "no-store" });

        if (!response.ok) {
          throw new Error("Could not read conversion progress.");
        }

        const nextJob = (await response.json()) as JobSnapshot;
        setJob(nextJob);

        if (nextJob.status === "complete") {
          setStatus("complete");
          return;
        }

        if (nextJob.status === "error") {
          setStatus("error");
          setError(nextJob.error || "Conversion failed.");
          return;
        }

        if (nextJob.status === "cancelled") {
          setStatus("error");
          setError("Conversion cancelled.");
        }
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Could not read conversion progress.");
      }
    }

    void pollJob();
    const interval = window.setInterval(() => void pollJob(), 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeJobId, status]);

  useEffect(() => {
    if (!job || job.status !== "complete" || downloadedJobId === job.id) {
      return;
    }

    async function downloadFinishedJob() {
      if (!job) {
        return;
      }

      try {
        const response = await fetch(`/api/jobs/${job.id}/download`);

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "The converted file was not ready for download.");
        }

        const blob = await response.blob();
        const href = window.URL.createObjectURL(blob);
        const filename = getFilename(response);

        setDownload({ href, filename, size: blob.size });
        setDownloadedJobId(job.id);
        triggerDownload(href, filename);
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Could not download the converted file.");
      }
    }

    void downloadFinishedJob();
  }, [downloadedJobId, job]);

  async function handlePaste() {
    setPasteMessage(null);

    try {
      const text = await navigator.clipboard.readText();
      setUrl(text.trim());
      setPasteMessage("Pasted from clipboard.");
    } catch {
      setPasteMessage("Clipboard access was not available.");
    }
  }

  async function cancelConversion() {
    if (!job || status !== "converting") {
      return;
    }

    await fetch(`/api/jobs/${job.id}`, { method: "DELETE" }).catch(() => undefined);
    setStatus("error");
    setError("Conversion cancelled.");
    setJob(null);
  }

  async function startFresh() {
    if (job && status === "converting") {
      await fetch(`/api/jobs/${job.id}`, { method: "DELETE" }).catch(() => undefined);
    }

    if (download?.href) {
      window.URL.revokeObjectURL(download.href);
    }

    setUrl("");
    setMode("single");
    setStatus("idle");
    setError(null);
    setDownload(null);
    setJob(null);
    setDownloadedJobId(null);
    setPasteMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("converting");
    setError(null);
    setPasteMessage(null);

    if (download?.href) {
      window.URL.revokeObjectURL(download.href);
      setDownload(null);
    }
    setJob(null);
    setDownloadedJobId(null);

    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, mode }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Conversion failed.");
      }

      const nextJob = (await response.json()) as JobSnapshot;
      setJob(nextJob);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <main className="min-h-screen bg-[#101010] text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-300">
              Experimental local converter
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal text-white sm:text-3xl">
              YouTube to MP3
            </h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-300">
            <span className="border border-white/10 bg-white/[0.04] px-3 py-1.5">yt-dlp</span>
            <span className="border border-white/10 bg-white/[0.04] px-3 py-1.5">FFmpeg</span>
            <span className="border border-white/10 bg-white/[0.04] px-3 py-1.5">MP3 / ZIP</span>
          </div>
        </header>

        <section className="grid flex-1 items-start gap-6 py-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <form
            onSubmit={handleSubmit}
            className="border border-white/10 bg-[#181818] p-5 shadow-2xl shadow-black/30 sm:p-6"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center bg-red-500 text-white">
                <LinkIcon />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Source video</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-400">
                  Paste a public YouTube URL, convert one video to MP3, or package a playlist as a ZIP.
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <p className="text-sm font-medium text-zinc-200">Conversion mode</p>
              <div className="grid grid-cols-2 border border-white/12 bg-black p-1">
                <button
                  type="button"
                  onClick={() => setMode("single")}
                  disabled={status === "converting"}
                  className={`min-h-11 px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    mode === "single" ? "bg-red-500 text-white" : "text-zinc-300 hover:bg-white/[0.06]"
                  }`}
                >
                  Single video
                </button>
                <button
                  type="button"
                  onClick={() => setMode("playlist")}
                  disabled={status === "converting"}
                  className={`min-h-11 px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    mode === "playlist" ? "bg-red-500 text-white" : "text-zinc-300 hover:bg-white/[0.06]"
                  }`}
                >
                  Playlist ZIP
                </button>
              </div>
              <p className="text-sm leading-6 text-zinc-400">
                {mode === "single"
                  ? "Single mode downloads one MP3 named from the video title."
                  : "Playlist mode converts playlist entries and downloads one ZIP with title-named MP3 files."}
              </p>
            </div>

            <div className="mt-6 space-y-3">
              <label className="text-sm font-medium text-zinc-200" htmlFor="youtube-url">
                {mode === "single" ? "YouTube video URL" : "YouTube playlist URL"}
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  id="youtube-url"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder={
                    mode === "single"
                      ? "https://www.youtube.com/watch?v=..."
                      : "https://www.youtube.com/playlist?list=..."
                  }
                  className="min-h-12 flex-1 border border-white/12 bg-black px-4 text-base text-white outline-none placeholder:text-zinc-600 focus:border-red-400"
                  required
                  disabled={status === "converting"}
                />
                <button
                  type="button"
                  onClick={handlePaste}
                  disabled={status === "converting"}
                  className="inline-flex min-h-12 items-center justify-center gap-2 border border-white/12 bg-white/[0.06] px-4 text-sm font-semibold text-white transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ClipboardIcon />
                  Paste
                </button>
              </div>
              {pasteMessage ? <p className="text-sm text-zinc-400">{pasteMessage}</p> : null}
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 bg-red-500 px-5 font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
              >
                {status === "converting" ? (
                  <span className="h-5 w-5 animate-spin border-2 border-white/30 border-t-white" />
                ) : (
                  <DownloadIcon />
                )}
                {status === "converting"
                  ? mode === "playlist"
                    ? "Building ZIP"
                    : "Converting"
                  : mode === "playlist"
                    ? "Convert Playlist"
                    : "Convert and Download"}
              </button>
              <button
                type="button"
                onClick={() => void startFresh()}
                className="inline-flex min-h-12 items-center justify-center gap-2 border border-white/12 px-5 font-semibold text-zinc-200 transition hover:bg-white/[0.06]"
              >
                <RefreshIcon />
                New conversion
              </button>
              {status === "converting" ? (
                <button
                  type="button"
                  onClick={() => void cancelConversion()}
                  className="inline-flex min-h-12 items-center justify-center border border-red-400/50 px-5 font-semibold text-red-200 transition hover:bg-red-400/10"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>

          <aside className="border border-white/10 bg-[#181818] p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-white">Status</h2>

            <div className="mt-5 space-y-4">
              <div
                className={`border p-4 ${
                  status === "complete"
                    ? "border-emerald-400/40 bg-emerald-400/10"
                    : status === "error"
                      ? "border-red-400/40 bg-red-400/10"
                      : status === "converting"
                        ? "border-amber-300/40 bg-amber-300/10"
                        : "border-white/10 bg-black/25"
                }`}
              >
                <p className="text-sm font-semibold text-white">
                  {status === "idle" ? "Ready" : null}
                  {status === "converting" ? "Converting audio" : null}
                  {status === "complete" ? "Conversion complete" : null}
                  {status === "error" ? "Needs attention" : null}
                </p>
                <p className="mt-2 text-sm leading-6 text-zinc-300">
                  {status === "idle" ? "Waiting for a YouTube link." : null}
                  {status === "converting"
                    ? job?.message ||
                      (mode === "playlist"
                        ? "Keep this tab open while the server converts playlist items and packages the ZIP."
                        : "Keep this tab open while the server extracts and encodes the MP3.")
                    : null}
                  {status === "complete" && download
                    ? `${download.filename} is ready. The download should have started automatically.`
                    : null}
                  {status === "error" ? error : null}
                </p>
              </div>

              {job && status === "converting" ? (
                <div className="border border-white/10 bg-black/25 p-4">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-white">{job.stage}</span>
                    <span className="text-zinc-300">{Math.round(job.progress)}%</span>
                  </div>
                  <div className="mt-3 h-2 bg-white/10">
                    <div
                      className="h-full bg-red-500 transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
                    />
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-zinc-400">
                    {job.playlistPosition && job.playlistTotal ? (
                      <div className="flex items-center justify-between gap-3 border border-white/10 px-3 py-2">
                        <span>Playlist item</span>
                        <span className="font-medium text-zinc-100">
                          {job.playlistPosition} of {job.playlistTotal}
                        </span>
                      </div>
                    ) : null}
                    {job.currentItem ? (
                      <div className="border border-white/10 px-3 py-2">
                        <p className="text-zinc-400">Current file</p>
                        <p className="mt-1 break-all font-medium text-zinc-100">{job.currentItem}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {download ? (
                <div className="border border-white/10 bg-black/25 p-4">
                  <p className="text-sm text-zinc-400">Ready file</p>
                  <p className="mt-1 break-all text-sm font-medium text-white">{download.filename}</p>
                  <p className="mt-1 text-sm text-zinc-400">{formatBytes(download.size)}</p>
                  <button
                    type="button"
                    onClick={() => triggerDownload(download.href, download.filename)}
                    className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 bg-emerald-400 px-4 font-semibold text-black transition hover:bg-emerald-300"
                  >
                    <DownloadIcon />
                    {download.filename.toLowerCase().endsWith(".zip") ? "Download ZIP" : "Download MP3"}
                  </button>
                </div>
              ) : null}

              <div className="grid gap-3 text-sm text-zinc-300">
                <div className="flex items-center justify-between border border-white/10 px-3 py-2">
                  <span>Input</span>
                  <span className="font-medium text-zinc-100">{url ? "URL added" : "Empty"}</span>
                </div>
                <div className="flex items-center justify-between border border-white/10 px-3 py-2">
                  <span>Output</span>
                  <span className="font-medium text-zinc-100">{mode === "playlist" ? "ZIP" : "MP3"}</span>
                </div>
                <div className="flex items-center justify-between border border-white/10 px-3 py-2">
                  <span>Mode</span>
                  <span className="font-medium text-zinc-100">
                    {mode === "playlist" ? "Playlist" : "Single video"}
                  </span>
                </div>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
