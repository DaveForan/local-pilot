#!/usr/bin/env bash
# Build whisper.cpp and fetch a model, for local-pilot's server-side speech
# transcription. Self-contained: if cmake is missing, a standalone copy is
# downloaded — no sudo, no system changes.
set -euo pipefail

MODEL="${1:-base.en}"
WHISPER_DIR="${LOCAL_PILOT_DATA:-$HOME/.local-pilot}/whisper"
mkdir -p "$WHISPER_DIR/models"
cd "$WHISPER_DIR"

# --- cmake -----------------------------------------------------------------
CMAKE="$(command -v cmake || true)"
if [ -z "$CMAKE" ]; then
  CMAKE_VER=3.31.6
  if [ ! -x "$WHISPER_DIR/cmake/bin/cmake" ]; then
    echo "==> cmake not found — fetching a standalone copy (no sudo needed)"
    curl -fSL "https://github.com/Kitware/CMake/releases/download/v${CMAKE_VER}/cmake-${CMAKE_VER}-linux-x86_64.tar.gz" -o cmake.tgz
    rm -rf cmake && mkdir cmake
    tar -xzf cmake.tgz -C cmake --strip-components=1
    rm cmake.tgz
  fi
  CMAKE="$WHISPER_DIR/cmake/bin/cmake"
fi
echo "==> cmake: $CMAKE"

# --- whisper.cpp -----------------------------------------------------------
if [ ! -d whisper.cpp/.git ]; then
  echo "==> cloning whisper.cpp"
  git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git
fi
cd whisper.cpp
echo "==> building whisper.cpp (CPU, Release)"
"$CMAKE" -B build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF
"$CMAKE" --build build -j

# locate the CLI binary (newer builds: whisper-cli; older: main)
BIN=""
for c in build/bin/whisper-cli build/bin/main; do
  if [ -x "$c" ]; then
    BIN="$(pwd)/$c"
    break
  fi
done
if [ -z "$BIN" ]; then
  echo "error: build produced no whisper CLI binary" >&2
  exit 1
fi

# --- model -----------------------------------------------------------------
MODEL_FILE="$WHISPER_DIR/models/ggml-${MODEL}.bin"
if [ ! -f "$MODEL_FILE" ]; then
  echo "==> downloading model ggml-${MODEL}.bin"
  curl -fSL "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL}.bin" \
    -o "$MODEL_FILE"
fi

# record the resolved binary path for the server to read
echo "$BIN" > "$WHISPER_DIR/binpath"

echo
echo "Whisper is ready:"
echo "  binary: $BIN"
echo "  model:  $MODEL_FILE"
echo "Restart local-pilot to pick it up:  systemctl --user restart local-pilot"
