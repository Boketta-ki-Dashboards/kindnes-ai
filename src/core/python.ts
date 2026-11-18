import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {PATHS} from './paths.js';
import {readJson} from './fsutil.js';

export interface PythonResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

const PYTHON = process.env.KAI_PYTHON ?? 'python3';

/** Run `python -m kindness_analysis <args> --out <file>` and parse the JSON result. */
export function runAnalysis<T>(args: string[], outFile: string, timeoutMs = 15 * 60_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, ['-m', 'kindness_analysis', ...args, '--out', outFile], {
      env: {...process.env, PYTHONPATH: PATHS.python, PYTHONWARNINGS: 'ignore'},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    proc.stderr.on('data', (d) => (err += d.toString()));
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(outFile)) resolve(readJson<T>(outFile));
      else reject(new Error(`analysis ${args[0]} failed (${code}): ${err.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}
