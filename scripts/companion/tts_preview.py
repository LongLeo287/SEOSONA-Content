#!/usr/bin/env python3
"""
SEOSONA Content — TTS preview companion (rany2/edge-tts).

The extension turns SRT into cut/short scripts; this companion voices a generated script so you can
hear pacing before editing, and emits a timed SRT alongside the audio (edge-tts SubMaker).
Standalone by design — the Chrome extension can't run Python; run this next to it.

Usage:
  python tts_preview.py script.txt [--voice vi-VN-HoaiMyNeural] [--out out]
Deps:
  pip install edge-tts        # free Microsoft Edge voices, incl. Vietnamese

Honest: exits with a clear message if edge-tts is missing — never fakes audio.
"""
import argparse
import asyncio
import sys


async def _run(text, voice, out):
    try:
        import edge_tts
    except ImportError:
        sys.exit("edge-tts not installed — `pip install edge-tts`")
    communicate = edge_tts.Communicate(text, voice)
    submaker = edge_tts.SubMaker()
    with open(f"{out}.mp3", "wb") as audio:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                submaker.feed(chunk)
    with open(f"{out}.srt", "w", encoding="utf-8") as srt:
        srt.write(submaker.get_srt())
    print(f"-> {out}.mp3 + {out}.srt (voice={voice})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("script")
    ap.add_argument("--voice", default="vi-VN-HoaiMyNeural")
    ap.add_argument("--out", default="tts_preview")
    a = ap.parse_args()
    text = open(a.script, encoding="utf-8").read().strip()
    if not text:
        sys.exit("empty script")
    asyncio.run(_run(text, a.voice, a.out))


if __name__ == "__main__":
    main()
