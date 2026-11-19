import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {acquireMedia, wikimediaVideoUrls} from '../src/acquisition/acquire';
import {loadPipelineConfig} from '../src/core/config';
import type {Candidate} from '../src/core/types';

const ORIGINAL = 'https://upload.wikimedia.org/wikipedia/commons/4/45/TEST_clip.webm?utm_source=commons.wikimedia.org';

function candidate(id: string): Candidate {
  return {id, platform: 'wikimedia', platformId: 'TEST_clip.webm', url: 'https://commons.wikimedia.org/wiki/File:TEST_clip.webm', title: 'TEST', license: 'Public domain', mediaUrl: ORIGINAL, media: {status: 'downloadable'}} as unknown as Candidate;
}

describe('Wikimedia download (rate-limited originals)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists the original first, then the standard transcoded sizes', () => {
    const u = wikimediaVideoUrls(ORIGINAL);
    expect(u[0]).toBe('https://upload.wikimedia.org/wikipedia/commons/4/45/TEST_clip.webm');
    expect(u.slice(1)).toEqual([
      'https://upload.wikimedia.org/wikipedia/commons/transcoded/4/45/TEST_clip.webm/TEST_clip.webm.720p.vp9.webm',
      'https://upload.wikimedia.org/wikipedia/commons/transcoded/4/45/TEST_clip.webm/TEST_clip.webm.480p.vp9.webm',
    ]);
  });

  it('falls back to a transcode on HTTP 429 and reports every failure otherwise', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kai-wm-'));
    const clip = path.join(dir, 'TEST_480p.webm');
    spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25:d=1', '-f', 'lavfi', '-i', 'sine=d=1', '-c:v', 'libvpx-vp9', '-c:a', 'libopus', '-shortest', clip]);
    const bytes = fs.readFileSync(clip);
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url);
      return url.includes('.480p.') ? new Response(bytes, {status: 200}) : new Response('Too many requests', {status: 429});
    });
    const c = candidate('TEST_wm-fallback');
    const r = await acquireMedia(c, loadPipelineConfig());
    expect(r.ok).toBe(true);
    expect(r.method).toBe('wikimedia');
    expect(asked.map((u) => (u.includes('/transcoded/') ? u.split('.').slice(-3, -2)[0] : 'original'))).toEqual(['original', '720p', '480p']);
    expect(r.media!.width).toBe(320);
    fs.rmSync(r.media!.path, {force: true});

    vi.stubGlobal('fetch', async () => new Response('Too many requests', {status: 429}));
    const r2 = await acquireMedia(candidate('TEST_wm-blocked'), loadPipelineConfig());
    expect(r2.ok).toBe(false);
    expect(r2.reason).toMatch(/original: download failed: HTTP 429.*720p.*480p/);
    fs.rmSync(dir, {recursive: true, force: true});
  });
});
