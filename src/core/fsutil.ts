import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, {recursive: true});
}

export function readJson<T>(file: string, fallback?: T): T {
  if (!fs.existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`JSON file not found: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

/** Atomic JSON write (tmp file + rename) so an interrupted run never leaves a half-written file. */
export function writeJson(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

export function sha256File(file: string): string {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1 << 20);
  try {
    let n: number;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

export function sha1(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex');
}

export function fileSize(file: string): number {
  return fs.statSync(file).size;
}

export function nowIso(): string {
  return new Date().toISOString();
}
