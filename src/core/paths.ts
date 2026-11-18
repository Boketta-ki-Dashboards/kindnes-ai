import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** Repository root (works from src/ via tsx and from compiled output). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PATHS = {
  root: ROOT,
  config: path.join(ROOT, 'config'),
  pipelineConfig: path.join(ROOT, 'config', 'pipeline.json'),
  assetsConfig: path.join(ROOT, 'config', 'assets.json'),
  musicConfig: path.join(ROOT, 'config', 'music.json'),
  data: path.join(ROOT, 'data'),
  analysis: path.join(ROOT, 'data', 'analysis'),
  candidates: path.join(ROOT, 'data', 'candidates.json'),
  productions: path.join(ROOT, 'data', 'productions.json'),
  logs: path.join(ROOT, 'data', 'logs'),
  jobs: path.join(ROOT, 'data', 'jobs'),
  media: path.join(ROOT, 'media'),
  inbox: path.join(ROOT, 'media', 'inbox'),
  downloads: path.join(ROOT, 'media', 'downloads'),
  cache: path.join(ROOT, '.cache'),
  output: path.join(ROOT, 'output'),
  python: path.join(ROOT, 'python'),
  remotionEntry: path.join(ROOT, 'src', 'remotion', 'index.ts'),
  rawExamples: path.join(ROOT, 'references', 'raw-examples'),
} as const;

export const rel = (p: string): string => path.relative(ROOT, p).split(path.sep).join('/');
export const abs = (p: string): string => (path.isAbsolute(p) ? p : path.join(ROOT, p));
