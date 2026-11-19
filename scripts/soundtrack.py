"""Music under the voice, a whoosh on each speaker change, and the credit lines.

Reads out/<ep>/dialogue.wav and timeline.json, episodes/<ep>/script.json, and the audio-library
catalogue (catalog/catalog.json and catalog/sfx.json) from CATALOG_DIR. Writes:
  out/<ep>/mix.wav       voice + ducked music + whooshes, normalised to -14 LUFS
  out/<ep>/credits.txt   attribution lines for the description (CC BY needs them)
Without a catalogue it copies the voice track as the mix, so a render never fails for lack of music.

Usage: python scripts/soundtrack.py <episode> [catalog_dir]
"""

import hashlib
import json
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "video-factory/1.0"}
MOOD = {
    "how-it-works": "tech-corporate",
    "anime-explained": "uplifting-happy",
    "why-is-it-like-that": "calm-ambient",
    "games-and-gadgets": "action-epic",
    "myth-or-fact": "comedy-quirky",
    "versus": "action-epic",
    "sunday-teaser": "tension-suspense",
}
MUSIC_GAIN = 0.22
WHOOSH_GAIN = 0.45


def pick(rows, key, prefer):
    """Stable choice for this episode: preferred rows first, then rotate by a hash of the episode id."""
    rows = sorted(rows, key=lambda r: (not prefer(r), r["download"]))
    if not rows:
        return []
    start = int(hashlib.sha1(key.encode()).hexdigest(), 16) % len(rows)
    return rows[start:] + rows[:start]


def download(url, dest):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)
    return dest.stat().st_size > 10_000 or dest.suffix != ".mp3"


def first_working(candidates, dest_base, limit=5):
    for row in candidates[:limit]:
        ext = Path(row["download"].split("?")[0]).suffix or ".mp3"
        dest = dest_base.with_suffix(ext)
        try:
            if download(row["download"], dest):
                return row, dest
        except Exception:
            continue
    return None, None


def main():
    ep = sys.argv[1]
    catalog_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "catalog"
    out = ROOT / "out" / ep
    timeline = json.loads((out / "timeline.json").read_text())
    script = json.loads((ROOT / "episodes" / ep / "script.json").read_text())
    dur = round(timeline["duration"] + 0.5, 2)
    credits = []

    music = whoosh = None
    if (catalog_dir / "catalog.json").exists():
        cat = json.loads((catalog_dir / "catalog.json").read_text())
        rows = [r for r in cat.get(MOOD.get(script.get("series"), "tech-corporate"), []) if (r.get("seconds") or 0) >= dur + 3]
        cand = pick(rows, ep, lambda r: r.get("source") == "incompetech" or r.get("license") == "CC0")
        row, music = first_working(cand, out / "music")
        if row:
            credits.append(f'Music: {row["attribution"]}' if row.get("license") != "CC0" else f'Music: "{row["title"]}" by {row.get("creator")} (CC0)')
    if (catalog_dir / "sfx.json").exists():
        sfx = json.loads((catalog_dir / "sfx.json").read_text())
        rows = [r for r in sfx.get("whoosh", []) if 0 < (r.get("seconds") or 0) <= 2]
        row, whoosh = first_working(pick(rows, ep, lambda r: r.get("license") == "CC0"), out / "whoosh")
        if row and row.get("license") != "CC0":
            credits.append(f'Sound effect: {row["attribution"]}')

    voice = out / "dialogue.wav"
    if not music:
        shutil.copy(voice, out / "mix.wav")
        (out / "credits.txt").write_text("\n".join(credits) + ("\n" if credits else ""))
        print("no music: voice only")
        return

    lines = timeline["lines"]
    switches = [max(0, l["start"] - 0.12) for i, l in enumerate(lines) if i and l["speaker"] != lines[i - 1]["speaker"]] if whoosh else []

    inputs = ["-i", str(voice), "-stream_loop", "-1", "-i", str(music)] + (["-i", str(whoosh)] if switches else [])
    f = [
        f"[0:a]aresample=48000,apad=whole_dur={dur},asplit=2[v1][v2]",
        f"[1:a]aresample=48000,atrim=0:{dur},asetpts=N/SR/TB,afade=t=in:st=0:d=1,afade=t=out:st={dur - 1.5}:d=1.5,volume={MUSIC_GAIN}[m]",
        "[m][v2]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=350[md]",
    ]
    mix_in = ["[v1]", "[md]"]
    if switches:
        f.append(f"[2:a]aresample=48000,volume={WHOOSH_GAIN},asplit={len(switches)}" + "".join(f"[w{i}]" for i in range(len(switches))))
        for i, t in enumerate(switches):
            ms = int(t * 1000)
            f.append(f"[w{i}]adelay={ms}|{ms}[wd{i}]")
            mix_in.append(f"[wd{i}]")
    f.append("".join(mix_in) + f"amix=inputs={len(mix_in)}:normalize=0:duration=first,atrim=0:{dur},loudnorm=I=-14:TP=-1.5:LRA=11[out]")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *inputs, "-filter_complex", ";".join(f),
                    "-map", "[out]", "-ar", "48000", "-ac", "2", str(out / "mix.wav")], check=True)
    (out / "credits.txt").write_text("\n".join(credits) + "\n")
    print(f"mix: music + {len(switches)} whooshes, {dur}s")


if __name__ == "__main__":
    main()
