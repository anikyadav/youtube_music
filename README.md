# YouTube MP3 Converter

Experimental Next.js app that lets you paste a YouTube URL, converts audio on the server, and starts a browser download.

## Features

- Convert a single YouTube video to an MP3 named from the video title.
- Convert a YouTube playlist into one ZIP containing title-named MP3 files.
- Keep completed downloads available in the browser for repeat download until a new conversion starts.
- Show conversion progress while `yt-dlp` downloads and encodes audio.
- Cancel an active conversion from the UI.

## Requirements

- Node.js
- `yt-dlp` available on your PATH
- `ffmpeg` available on your PATH
- A JavaScript runtime supported by `yt-dlp`, such as Deno

On Windows, install the external tools with a package manager such as Chocolatey or Winget, then restart your terminal so PATH updates are picked up.

```powershell
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg
winget install DenoLand.Deno
```

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Build

```bash
npm run build
```

## Notes

This is an experimental local utility. Only download media when you have the rights or permission to do so, and respect YouTube's terms and applicable law.

Playlist conversion can take a while because every playlist item is downloaded and encoded before the ZIP is returned.

The UI uses a job-based API:

- `POST /api/jobs` starts a conversion.
- `GET /api/jobs/:id` reads progress and status.
- `DELETE /api/jobs/:id` cancels an active conversion.
- `GET /api/jobs/:id/download` downloads the completed MP3 or ZIP.
