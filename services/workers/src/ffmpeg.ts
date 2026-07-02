// Clip cutting with graceful degradation. ffmpeg is available on the dev host
// but NOT guaranteed on Railway (ARCHITECTURE section 4 / the brief). When it is
// absent (spawn ENOENT), the synthesis worker keeps the moment's t_start/t_end
// and references the raw object instead of a clip, and never crashes.

import { spawn } from 'node:child_process';

let _available: boolean | undefined;

/** Cached probe: is an `ffmpeg` binary on PATH? */
export async function ffmpegAvailable(): Promise<boolean> {
  if (_available !== undefined) return _available;
  _available = await new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (v: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const child = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
      child.on('error', () => done(false)); // ENOENT
      child.on('close', (code) => done(code === 0));
    } catch {
      done(false);
    }
  });
  return _available;
}

export interface CutClipArgs {
  inputPath: string;
  outputPath: string;
  startMs: number;
  endMs: number;
}

/**
 * Cut [startMs, endMs) from inputPath into outputPath as mp3. Rejects if ffmpeg
 * is missing or exits non-zero; callers degrade on rejection.
 */
export async function cutClip(args: CutClipArgs): Promise<void> {
  const start = Math.max(0, args.startMs) / 1000;
  const duration = Math.max(0, args.endMs - args.startMs) / 1000;
  if (duration <= 0) throw new Error('clip duration is non-positive');

  await new Promise<void>((resolve, reject) => {
    // -ss before -i for fast input seek; re-encode to a small mp3.
    const child = spawn(
      'ffmpeg',
      [
        '-nostdin',
        '-y',
        '-ss',
        String(start),
        '-t',
        String(duration),
        '-i',
        args.inputPath,
        '-vn',
        '-c:a',
        'libmp3lame',
        '-q:a',
        '4',
        args.outputPath,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on('error', reject); // ENOENT -> caller degrades
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}
