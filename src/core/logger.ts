import fs from 'node:fs';
import path from 'node:path';
import {PATHS} from './paths.js';
import {ensureDir} from './fsutil.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  at: string;
  level: LogLevel;
  scope: string;
  msg: string;
  candidateId?: string;
  data?: unknown;
}

let quiet = process.env.KAI_QUIET === '1';
let logDir = process.env.KAI_LOG_DIR ?? PATHS.logs;

export function setQuiet(q: boolean): void {
  quiet = q;
}

/** Tests redirect logs to a temp dir. */
export function setLogDir(dir: string): void {
  logDir = dir;
}

function write(entry: LogEntry): void {
  try {
    ensureDir(logDir);
    const day = entry.at.slice(0, 10);
    fs.appendFileSync(path.join(logDir, `pipeline-${day}.jsonl`), JSON.stringify(entry) + '\n');
  } catch {
    /* logging must never crash the pipeline */
  }
  if (!quiet || entry.level === 'error') {
    const tag = entry.candidateId ? ` [${entry.candidateId}]` : '';
    const line = `${entry.level.toUpperCase().padEnd(5)} ${entry.scope}${tag}: ${entry.msg}`;
    (entry.level === 'error' ? console.error : console.log)(line);
  }
}

export function logger(scope: string) {
  const mk =
    (level: LogLevel) =>
    (msg: string, extra: {candidateId?: string; data?: unknown} = {}) =>
      write({at: new Date().toISOString(), level, scope, msg, ...extra});
  return {debug: mk('debug'), info: mk('info'), warn: mk('warn'), error: mk('error')};
}
