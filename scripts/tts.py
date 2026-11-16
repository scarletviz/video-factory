"""Generate voice audio for episodes with Kokoro.

For each episode folder (episodes/<name>/script.json) this writes:
  out/<name>/lines/NN-<speaker>.wav   one file per line
  out/<name>/dialogue.wav             all lines joined with a short gap
  out/<name>/timeline.json            start/end time of every line (used later for lip sync and captions)

Usage:
  python scripts/tts.py                      # every episode
  python scripts/tts.py episodes/ep000-voice-test
"""

import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro import KPipeline

ROOT = Path(__file__).resolve().parent.parent
SAMPLE_RATE = 24000

_pipelines = {}


def pipeline_for(voice):
    lang = voice[0]  # "a" = American English, "b" = British English
    if lang not in _pipelines:
        _pipelines[lang] = KPipeline(lang_code=lang)
    return _pipelines[lang]


def synthesize(text, voice, speed):
    chunks = []
    for result in pipeline_for(voice)(text, voice=voice, speed=speed):
        audio = result.audio if hasattr(result, "audio") else result[2]
        if audio is None:
            continue
        chunks.append(audio.numpy() if hasattr(audio, "numpy") else np.asarray(audio))
    return np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)


def render_episode(episode_dir, voices):
    script = json.loads((episode_dir / "script.json").read_text())
    out_dir = ROOT / "out" / episode_dir.name
    lines_dir = out_dir / "lines"
    lines_dir.mkdir(parents=True, exist_ok=True)

    gap = np.zeros(int(script.get("gap_seconds", 0.25) * SAMPLE_RATE), dtype=np.float32)
    parts, timeline, cursor = [], [], 0.0

    for i, line in enumerate(script["lines"], start=1):
        speaker = line["speaker"]
        if speaker not in voices:
            raise SystemExit(f"{episode_dir.name}: no voice set for '{speaker}' in voices.json")
        cfg = voices[speaker]
        audio = synthesize(line["text"], cfg["voice"], cfg.get("speed", 1.0))

        wav_name = f"{i:02d}-{speaker}.wav"
        sf.write(lines_dir / wav_name, audio, SAMPLE_RATE)

        duration = len(audio) / SAMPLE_RATE
        timeline.append({
            "index": i,
            "speaker": speaker,
            "text": line["text"],
            "file": f"lines/{wav_name}",
            "start": round(cursor, 3),
            "end": round(cursor + duration, 3),
        })
        parts += [audio, gap]
        cursor += duration + len(gap) / SAMPLE_RATE
        print(f"  {wav_name}  {duration:5.2f}s  {line['text'][:60]}")

    sf.write(out_dir / "dialogue.wav", np.concatenate(parts), SAMPLE_RATE)
    (out_dir / "timeline.json").write_text(json.dumps({
        "title": script.get("title", episode_dir.name),
        "sample_rate": SAMPLE_RATE,
        "duration": round(cursor, 3),
        "lines": timeline,
    }, indent=2))
    print(f"{episode_dir.name}: {len(timeline)} lines, {cursor:.1f}s total")


def main():
    voices = {k: v for k, v in json.loads((ROOT / "voices.json").read_text()).items() if not k.startswith("_")}
    targets = [Path(a).resolve() for a in sys.argv[1:]] or sorted((ROOT / "episodes").glob("*/"))
    for episode_dir in targets:
        if (episode_dir / "script.json").exists():
            render_episode(episode_dir, voices)


if __name__ == "__main__":
    main()
