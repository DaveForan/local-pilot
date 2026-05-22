import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { paths } from './config';

// Server-side speech transcription via whisper.cpp. Audio arrives from the
// browser as a compressed clip; ffmpeg normalises it to 16 kHz mono WAV and
// the whisper.cpp CLI transcribes it. Build it with scripts/install-whisper.sh.

let binPath = '';

/** Locate the whisper binary recorded by the install script. Call at startup. */
export function initWhisper(): boolean {
  try {
    binPath = readFileSync(paths.whisperBinPath, 'utf8').trim();
  } catch {
    binPath = '';
  }
  return whisperReady();
}

/** True when both the whisper binary and the model are present. */
export function whisperReady(): boolean {
  return binPath !== '' && existsSync(binPath) && existsSync(paths.whisperModel);
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${path.basename(cmd)} failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}

/** Transcribe an audio clip (any ffmpeg-readable format) to plain text. */
export async function transcribe(audio: Buffer): Promise<string> {
  if (!whisperReady()) throw new Error('Whisper is not installed on the server');

  const stem = path.join(os.tmpdir(), `lp-stt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const inFile = `${stem}.in`;
  const wavFile = `${stem}.wav`;
  await fs.writeFile(inFile, audio);
  try {
    // Normalise to what whisper.cpp expects: 16 kHz mono 16-bit WAV.
    await run('ffmpeg', [
      '-nostdin', '-loglevel', 'error',
      '-i', inFile,
      '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 'wav',
      '-y', wavFile,
    ]);
    // -nt: no timestamps, -np: no progress prints — stdout is just the text.
    const out = await run(binPath, ['-m', paths.whisperModel, '-f', wavFile, '-nt', '-np']);
    return out.replace(/\s+/g, ' ').trim();
  } finally {
    await fs.rm(inFile, { force: true });
    await fs.rm(wavFile, { force: true });
  }
}
