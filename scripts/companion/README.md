# Content — companion tools

The extension is Chrome MV3 (JS) and can't run Python, so these Python companions run *alongside*
it in the SRT → script workflow (from the SEOSONA UAP harvest, 2026-07):

- **tts_preview.py** — voice a generated script with edge-tts (free VN voices) + emit a timed SRT.
  `pip install edge-tts` → `python tts_preview.py script.txt`.
- **buzz** (chidiwilliams/buzz) — audio/video → SRT/VTT via faster-whisper + yt-dlp. Use to *make*
  the `.srt` the extension consumes. Install: `pip install buzz-captions` (or the desktop app).
- **markitdown** (microsoft/markitdown) — PDF/DOCX/PPTX/HTML/YouTube/audio → clean Markdown, a
  source-material feeder. `pip install markitdown`. (OS already ships `npm run pdf:extract` for PDFs.)

All optional, all local/free. None are wired into the extension — they are pre/post-processing aids.
