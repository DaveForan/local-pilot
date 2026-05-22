#!/usr/bin/env bash
# Install Piper neural TTS — a self-contained, MIT-licensed text-to-speech
# engine that runs offline on CPU and sounds much more natural than browser
# defaults. Used by local-pilot's read-aloud feature.
set -euo pipefail

VOICE="${1:-${LOCAL_PILOT_PIPER_VOICE:-en_US-amy-medium}}"
PIPER_VERSION="${PIPER_VERSION:-2023.11.14-2}"
PIPER_DIR="${LOCAL_PILOT_DATA:-$HOME/.local-pilot}/piper"

mkdir -p "$PIPER_DIR/voices"

# --- binary -----------------------------------------------------------------
if [ ! -x "$PIPER_DIR/piper/piper" ]; then
  echo "==> downloading piper $PIPER_VERSION"
  cd "$PIPER_DIR"
  curl -fSL "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz" \
    -o piper.tgz
  tar -xzf piper.tgz
  rm piper.tgz
fi
BIN="$PIPER_DIR/piper/piper"
if [ ! -x "$BIN" ]; then
  echo "error: piper binary missing after extract" >&2
  exit 1
fi

# --- voice model ------------------------------------------------------------
# Voice naming: <lang_full>-<name>-<quality>, e.g. en_US-amy-medium
LANG_FULL="${VOICE%%-*}"        # en_US
REST="${VOICE#*-}"               # amy-medium
NAME="${REST%%-*}"               # amy
QUALITY="${REST#*-}"             # medium
LANG_SHORT="${LANG_FULL%%_*}"    # en
BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/${LANG_SHORT}/${LANG_FULL}/${NAME}/${QUALITY}"

for ext in onnx onnx.json; do
  f="$PIPER_DIR/voices/${VOICE}.${ext}"
  if [ ! -f "$f" ]; then
    echo "==> downloading ${VOICE}.${ext}"
    curl -fSL "${BASE_URL}/${VOICE}.${ext}" -o "$f"
  fi
done

# Record resolved paths for the server to pick up.
echo "$BIN" > "$PIPER_DIR/binpath"
echo "$PIPER_DIR/voices/${VOICE}.onnx" > "$PIPER_DIR/voicepath"

echo
echo "Piper TTS is ready:"
echo "  binary: $BIN"
echo "  voice:  $PIPER_DIR/voices/${VOICE}.onnx"
echo "Restart local-pilot to pick it up:  systemctl --user restart local-pilot"
