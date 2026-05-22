import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { paths } from './config';

// Server-side text-to-speech via Piper — fast neural TTS that runs on CPU
// and sounds much more natural than browser defaults. MIT-licensed, fully
// offline. Build it with scripts/install-piper.sh.

let binPath = '';
let voicePath = '';
let binDir = '';

/** Locate the Piper binary + voice recorded by the install script. */
export function initTts(): boolean {
  try {
    binPath = readFileSync(paths.piperBinPath, 'utf8').trim();
    voicePath = readFileSync(paths.piperVoicePath, 'utf8').trim();
    binDir = path.dirname(binPath); // so Piper finds its bundled .so libs
  } catch {
    binPath = '';
    voicePath = '';
    binDir = '';
  }
  return ttsReady();
}

export function ttsReady(): boolean {
  return Boolean(binPath && voicePath && existsSync(binPath) && existsSync(voicePath));
}

/** Synthesize `text` into a WAV buffer. */
export async function synthesize(text: string): Promise<Buffer> {
  if (!ttsReady()) throw new Error('Piper TTS is not installed');
  const out = path.join(
    os.tmpdir(),
    `lp-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`,
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        binPath,
        ['--model', voicePath, '--output_file', out],
        // cwd = binDir so the binary finds its bundled libonnxruntime.so etc.
        { cwd: binDir, stdio: ['pipe', 'ignore', 'pipe'] },
      );
      let stderr = '';
      proc.stderr.on('data', (d) => (stderr += d));
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`piper exited ${code}: ${stderr.trim().slice(0, 400)}`));
      });
      proc.stdin.end(text);
    });
    return await fs.readFile(out);
  } finally {
    await fs.rm(out, { force: true });
  }
}
