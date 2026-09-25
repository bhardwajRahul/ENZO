# moshi-voice.ps1 — ENZO's true local speech-to-speech on Windows, on demand.
#
# Runs Kyutai's Moshi (moshiko) through the Rust/Candle backend on the CPU —
# the only Moshi runtime that exists for Windows (there is no GGUF/llama.cpp
# port of its audio-token architecture, and no MLX outside Apple Silicon).
# One model, audio in, audio out — the same architecture as ChatGPT's voice
# mode, running entirely on this machine.
#
# On-demand lifecycle (nothing baked into any image):
#   - The repo clone + weights live in the user's cache dir, one-time download
#     only when this script first runs.
#   - The model process only exists while the server runs; stop it and the RAM
#     is released instantly.
#
# REQUIREMENTS (one-time, heavy — say yes to both when the installers ask):
#   1. Rust toolchain  → https://rustup.rs  (installs rustup + MSVC Build Tools)
#   2. Git             → https://git-scm.com
#
# HONEST HARDWARE NOTE: the q8 dialogue model is ~8GB of RAM and a 7B-parameter
# model on CPU threads. On an i7-10th-gen (6+ cores) with 16GB RAM it is the
# best available attempt, but realtime smoothness is NOT guaranteed — this is
# exactly what the first run tests. If the web UI lags badly on your hardware,
# ENZO's browser voice mode (cloud brain + browser audio) is the smooth path.
#
# Run: powershell -ExecutionPolicy Bypass -File scripts/moshi-voice.ps1
$ErrorActionPreference = "Stop"

$CacheDir = "$env:USERPROFILE\.cache\enzo\moshi"
$RepoDir  = "$CacheDir\moshi"
$RepoUrl  = "https://github.com/kyutai-labs/moshi.git"

# ── 1. Toolchain gates ──────────────────────────────────────────────────────
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  Write-Host "moshi-voice: the Rust toolchain is required (one-time)."
  Write-Host "  Install it from https://rustup.rs — accept the MSVC Build Tools prompt —"
  Write-Host "  then reopen this terminal and run this script again."
  exit 1
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "moshi-voice: git is required (one-time). Install it from https://git-scm.com and rerun."
  exit 1
}

# ── 2. Repo + config (cached, one-time) ─────────────────────────────────────
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
if (-not (Test-Path "$RepoDir\rust\Cargo.toml")) {
  Write-Host "moshi-voice: cloning Kyutai's moshi (one-time)…"
  git clone --depth 1 $RepoUrl $RepoDir
}

# ── 3. Compile + run the CPU backend with the q8 weights ────────────────────
# The first compile takes a while (Candle + axum + the full server); the first
# run downloads the ~8GB q8 weights from Hugging Face into the HF cache.
Write-Host "moshi-voice: compiling + starting Moshi on the CPU (first run is slow)…"
Write-Host "  When it is up, open http://localhost:8998 — THAT page is the real test:"
Write-Host "  grant the mic and talk. If the voice keeps up on this hardware, the true"
Write-Host "  local voice mode works here. Ctrl+C to stop and release the RAM."
Push-Location "$RepoDir\rust"
try {
  cargo run --release --bin moshi-backend -- --config moshi-backend/config-q8.json standalone
} finally {
  Pop-Location
}
