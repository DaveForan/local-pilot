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
/** Extra args (e.g. ['--speaker','2']) — set when the voice is multi-speaker. */
let extraArgs: string[] = [];

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
    extraArgs = [];
    return false;
  }
  extraArgs = resolveSpeakerArgs();
  return ttsReady();
}

export function ttsReady(): boolean {
  return Boolean(binPath && voicePath && existsSync(binPath) && existsSync(voicePath));
}

/**
 * For multi-speaker voices (e.g. en_GB-semaine-medium), pick a speaker:
 * LOCAL_PILOT_PIPER_SPEAKER may be a numeric id or a name from the model's
 * speaker_id_map. Falls back to speaker 0 for multi-speaker voices.
 */
function resolveSpeakerArgs(): string[] {
  let map: Record<string, number> = {};
  try {
    const cfg = JSON.parse(readFileSync(`${voicePath}.json`, 'utf8')) as {
      speaker_id_map?: Record<string, number>;
    };
    map = cfg.speaker_id_map ?? {};
  } catch {
    return [];
  }
  if (Object.keys(map).length === 0) return []; // single-speaker — no arg needed

  const requested = process.env.LOCAL_PILOT_PIPER_SPEAKER?.trim() ?? '';
  if (/^\d+$/.test(requested)) {
    return ['--speaker', requested];
  }
  if (requested) {
    const id = map[requested];
    if (typeof id === 'number') return ['--speaker', String(id)];
    console.warn(
      `[piper] unknown speaker "${requested}" — available: ${Object.keys(map).join(', ')}`,
    );
  }
  // Default to the lowest-id entry in the map.
  const defaultId = Math.min(...Object.values(map));
  return ['--speaker', String(defaultId)];
}

export interface VoiceInfo {
  name: string;
  active: boolean;
}

/** List downloaded Piper voices (each is a *.onnx file with a .json sidecar). */
export async function listVoices(): Promise<VoiceInfo[]> {
  if (!voicePath) return [];
  const dir = path.dirname(voicePath);
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const activeName = path.basename(voicePath, '.onnx');
  const out: VoiceInfo[] = [];
  for (const f of entries) {
    if (!f.endsWith('.onnx')) continue;
    const name = f.slice(0, -'.onnx'.length);
    out.push({ name, active: name === activeName });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Switch the active Piper voice to one that's already been downloaded. */
export async function setVoice(name: string): Promise<void> {
  if (!voicePath) throw new Error('Piper is not installed');
  const dir = path.dirname(voicePath);
  const candidate = path.join(dir, `${name}.onnx`);
  if (!existsSync(candidate)) throw new Error(`Voice "${name}" is not downloaded`);
  if (!existsSync(`${candidate}.json`)) throw new Error(`Voice "${name}" is missing its config`);
  voicePath = candidate;
  // Persist so the next service restart loads the same voice.
  await fs.writeFile(paths.piperVoicePath, candidate, 'utf8');
  extraArgs = resolveSpeakerArgs();
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
        ['--model', voicePath, ...extraArgs, '--output_file', out],
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
