#!/usr/bin/env bash
# moshi-voice.sh — ENZO's true local speech-to-speech, on demand.
#
# Runs Kyutai's Moshi (moshiko) natively on Apple Silicon via MLX: the model
# hears the mic and speaks with its own voice, full-duplex, zero cloud calls.
# This is the same architecture as ChatGPT's voice mode — one model, audio in,
# audio out — except it runs entirely on the user's machine.
#
# On-demand lifecycle (nothing is baked into any image):
#   - The Python venv + the ~2GB q4 weights live in the user's cache dir
#     (~/.cache/enzo/moshi-venv + ~/.cache/huggingface) — one-time download,
#     only when this script first runs.
#   - The model process only exists while this script runs; kill it (or the
#     backend /api/voice-local/stop) and the RAM is released instantly.
#
# Hardware gate: MLX is Apple-Silicon only. On Intel/AMD or Linux without a
# supported runtime this exits with a clear message — the ENZO browser voice
# mode (Gemini Live / the STT→TTS chain) covers those machines instead.
#
# Run: bash scripts/moshi-voice.sh          (from the repo root)
set -euo pipefail

VENV="$HOME/.cache/enzo/moshi-venv"
HF_REPO="kyutai/moshika-mlx-q4"   # q4 ≈ 2GB, realtime on M1+; match -q to the repo

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "moshi-voice: MLX needs Apple Silicon (arm64 Mac)."
  if [[ "$(uname -s)" == "MINGW"* || "$(uname -s)" == "CYGWIN"* || "$(uname -s)" == "Windows_NT" ]]; then
    echo "  On Windows: powershell -ExecutionPolicy Bypass -File scripts/moshi-voice.ps1"
    echo "  (the Rust/Candle CPU backend — the only Moshi runtime for Windows)."
  else
    echo "  On this machine, use ENZO's browser voice mode instead (Gemini Live / the chain)."
  fi
  exit 1
fi

echo "moshi-voice: preparing the local model (one-time setup, cached)…"
if [[ ! -d "$VENV" ]]; then
  python3 -m venv "$VENV"
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"

if ! python3 -c "import moshi_mlx" >/dev/null 2>&1; then
  pip install -q -U moshi_mlx rustymimi
fi

echo "moshi-voice: starting Moshi (first run downloads ~2GB of weights to the HF cache)…"
echo "  Talk freely — the model speaks with its own voice. Ctrl+C to stop and release the RAM."
exec python3 -m moshi_mlx.local -q 4 --hf-repo "$HF_REPO"
