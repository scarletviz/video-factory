# video-factory

A public engine that turns a script into a vertical cartoon Short: Kokoro voices, Whisper word timings, Rhubarb lip sync, and a HyperFrames render.

This repo holds **no content**. Scripts, voices and character art live in private repos and are fetched at run time with a read-only token. The workflow never prints script text, and the finished video is **encrypted with [age](https://age-encryption.org)** before it is uploaded, so the public artifacts are unreadable without the private key, which never leaves the owner's machine.

## Run

Actions → **Produce** → Run workflow → episode ids, comma-separated (for example `2026-11-30-short,2026-12-01-short`). Each episode renders on its own machine.

## Decrypt

```
gh run download <run-id> --repo scarletviz/video-factory --dir dl
age -d -i ~/.config/vision-quest/age-key.txt -o ep.tar dl/<id>/<id>.tar.age
tar -xf ep.tar     # <id>.mp4 and <id>.script.json
```

## Setup (owner)

| Name | Kind | Value |
|---|---|---|
| `PRIVATE_READ_TOKEN` | secret | Fine-grained token: read-only **Contents** on the content and cast repos |
| `CONTENT_REPO` | variable | Private repo with `bank/<id>/script.json` and `voices.json` |
| `CAST_REPO` | variable | Private repo with `art/svg-2d-rig` |
| `AGE_RECIPIENT` | variable | Public age key (the private half stays offline) |

The workflow only runs on manual dispatch, so pull requests from forks can never reach the secrets.

## Credits

Kokoro-82M (Apache-2.0), whisper.cpp via HyperFrames (Apache-2.0), Rhubarb Lip Sync (MIT), HyperFrames (Apache-2.0).
