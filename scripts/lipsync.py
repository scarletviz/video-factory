"""Mouth shapes for every line with Rhubarb Lip Sync.

Reads out/<episode>/timeline.json (written by tts.py) and writes:
  out/<episode>/lips/NN-<speaker>.json   Rhubarb output for one line
  out/<episode>/lipsync.json             every speaker's mouth cues on the episode clock

lipsync.json looks like:
  { "speakers": { "kiko": [ { "start": 5.975, "value": "C" }, ... ], ... } }
Each speaker's list starts at 0 with "X" and returns to "X" after each of their lines,
so it can go straight into Rig.lipSync().

Usage:
  python scripts/lipsync.py                      # every episode in out/
  python scripts/lipsync.py out/ep000-voice-test
Needs `rhubarb` on PATH, or RHUBARB=/path/to/rhubarb.
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RHUBARB = os.environ.get("RHUBARB", "rhubarb")


def run_rhubarb(wav, text, out_json):
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as dialog:
        dialog.write(text)
    try:
        subprocess.run(
            [RHUBARB, "--quiet", "-f", "json", "--extendedShapes", "X",
             "-d", dialog.name, "-o", str(out_json), str(wav)],
            check=True,
        )
    finally:
        os.unlink(dialog.name)
    return json.loads(out_json.read_text())["mouthCues"]


def lipsync_episode(ep_dir):
    timeline = json.loads((ep_dir / "timeline.json").read_text())
    lips_dir = ep_dir / "lips"
    lips_dir.mkdir(exist_ok=True)

    speakers = {}
    for line in timeline["lines"]:
        wav = ep_dir / line["file"]
        cues = run_rhubarb(wav, line["text"], lips_dir / (Path(line["file"]).stem + ".json"))
        track = speakers.setdefault(line["speaker"], [{"start": 0.0, "value": "X"}])
        for cue in cues:
            track.append({"start": round(line["start"] + cue["start"], 3), "value": cue["value"]})
        track.append({"start": line["end"], "value": "X"})
        print(f"  {Path(line['file']).name}: {len(cues)} mouth cues")

    (ep_dir / "lipsync.json").write_text(json.dumps({"duration": timeline["duration"], "speakers": speakers}, indent=1))
    print(f"{ep_dir.name}: lip sync for {', '.join(speakers)}")


def main():
    targets = [Path(a).resolve() for a in sys.argv[1:]] or sorted((ROOT / "out").glob("*/"))
    for ep_dir in targets:
        if (ep_dir / "timeline.json").exists():
            lipsync_episode(ep_dir)


if __name__ == "__main__":
    main()
