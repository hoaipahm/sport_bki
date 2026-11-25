import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import { UPLOAD_DIR } from './uploader';

const TILE_CACHE_ROOT = path.join(UPLOAD_DIR, 'osm-hot-tiles');
const inFlight = new Map<string, Promise<{ buf: Buffer; mime: string } | null>>();

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function fetchStreetTile(z: number, x: number, y: number): Promise<{ buf: Buffer; mime: string } | null> {
  const sub = ['a', 'b', 'c'][(x + y) % 3];
  const candidates: Array<{ url: string; mime: string }> = [
    {
      url: `https://${sub}.tile.openstreetmap.fr/hot/${z}/${x}/${y}.png`,
      mime: 'image/png',
    },
    {
      url: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`,
      mime: 'image/jpeg',
    },
  ];

  for (const item of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const resp = await fetch(item.url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'image/png,image/jpeg,image/*;q=0.8',
        },
      });
      clearTimeout(timer);
      if (resp.ok) {
        const arr = await resp.arrayBuffer();
        const buf = Buffer.from(arr);
        if (buf.length > 500) {
          return { buf, mime: resp.headers.get('content-type') || item.mime };
        }
      }
    } catch {
      clearTimeout(timer);
    }
  }
  return null;
}

export async function serveMapTile(req: Request, res: Response) {
  const z = parseInt(String(req.params.z || ''), 10);
  const x = parseInt(String(req.params.x || ''), 10);
  const y = parseInt(String(req.params.y || '').replace(/\.(png|jpg|webp)$/i, ''), 10);

  if (
    !Number.isInteger(z) ||
    z < 0 ||
    z > 19 ||
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= Math.pow(2, z) ||
    y >= Math.pow(2, z)
  ) {
    return res.status(400).end();
  }

  ensureDir(TILE_CACHE_ROOT);
  const pngPath = path.join(TILE_CACHE_ROOT, `${z}_${x}_${y}.png`);
  const jpgPath = path.join(TILE_CACHE_ROOT, `${z}_${x}_${y}.jpg`);

  try {
    if (fs.existsSync(pngPath)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      return res.sendFile(pngPath);
    }
    if (fs.existsSync(jpgPath)) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      return res.sendFile(jpgPath);
    }

    const cacheKey = `${z}:${x}:${y}`;
    let pending = inFlight.get(cacheKey);
    if (!pending) {
      pending = fetchStreetTile(z, x, y).finally(() => {
        inFlight.delete(cacheKey);
      });
      inFlight.set(cacheKey, pending);
    }

    const result = await pending;
    if (result) {
      const isJpg = result.mime.includes('jpeg') || result.mime.includes('jpg');
      const savePath = isJpg ? jpgPath : pngPath;
      await fs.promises.writeFile(savePath, result.buf).catch(() => {});
      res.setHeader('Content-Type', isJpg ? 'image/jpeg' : 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      return res.send(result.buf);
    }
  } catch {
    // Fall through to SVG fallback
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(503).json({ error_code: 'MAP_TILES_UNAVAILABLE' });
}
