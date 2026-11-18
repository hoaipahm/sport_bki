import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

// Resolve persistent upload directory consistently across source and compiled layouts (Audit F-15)
export const UPLOAD_DIR = fs.existsSync(path.resolve(process.cwd(), 'backend'))
  ? path.resolve(process.cwd(), 'backend/uploads')
  : path.resolve(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Strict concurrency limiter to prevent CPU / RAM exhaustion (Audit F-15)
let activeProcessingTasks = 0;
const MAX_CONCURRENT_IMAGE_JOBS = 3;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB max per venue photo
const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB max per avatar
const MAX_INPUT_PIXELS = 40_000_000; // Guard against decompression bombs

const storage = multer.memoryStorage();

const imageFileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const allowedMime = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/jpg'];
  if (allowedMime.includes(file.mimetype.toLowerCase())) {
    cb(null, true);
  } else {
    cb(new Error('INVALID_FILE_TYPE'));
  }
};

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 10,
  },
  fileFilter: imageFileFilter,
});

export const avatarUploadMiddleware = multer({
  storage,
  limits: {
    fileSize: MAX_AVATAR_SIZE_BYTES,
    files: 1,
  },
  fileFilter: imageFileFilter,
});

export interface ProcessedImageResult {
  filename: string;
  url: string;
  original_name: string;
  original_size_bytes: number;
  compressed_size_bytes: number;
  saved_percent: string;
  width: number;
  height: number;
}

/**
 * Process a venue image buffer with sharp: resize max 1920x1080 + WebP + save to disk
 */
export async function optimizeAndSaveImage(
  buffer: Buffer,
  originalName: string
): Promise<ProcessedImageResult> {
  if (activeProcessingTasks >= MAX_CONCURRENT_IMAGE_JOBS) {
    throw new Error('SYSTEM_OVERLOADED');
  }

  activeProcessingTasks++;
  try {
    const uniqueId = crypto.randomUUID();
    const filename = `${uniqueId}.webp`;
    const outputPath = path.join(UPLOAD_DIR, filename);

    const image = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS });

    const processedBuffer = await image
      .rotate()
      .resize(1920, 1080, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();

    const metadata = await sharp(processedBuffer).metadata();
    await fs.promises.writeFile(outputPath, processedBuffer);

    const originalSize = buffer.length;
    const compressedSize = processedBuffer.length;
    const savedRatio = originalSize > 0 ? Math.max(0, (1 - compressedSize / originalSize) * 100) : 0;

    return {
      filename,
      url: `/uploads/${filename}`,
      original_name: originalName,
      original_size_bytes: originalSize,
      compressed_size_bytes: compressedSize,
      saved_percent: `${savedRatio.toFixed(1)}%`,
      width: metadata.width || 0,
      height: metadata.height || 0,
    };
  } finally {
    activeProcessingTasks--;
  }
}

/**
 * Process a user profile avatar buffer with sharp: square 320x320 cover crop + WebP
 */
export async function optimizeAvatarImage(
  buffer: Buffer,
  originalName: string
): Promise<ProcessedImageResult> {
  if (activeProcessingTasks >= MAX_CONCURRENT_IMAGE_JOBS) {
    throw new Error('SYSTEM_OVERLOADED');
  }

  activeProcessingTasks++;
  try {
    const uniqueId = crypto.randomUUID();
    const filename = `avatar-${uniqueId}.webp`;
    const outputPath = path.join(UPLOAD_DIR, filename);

    const processedBuffer = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(320, 320, {
        fit: 'cover',
        position: 'centre',
      })
      .webp({ quality: 84, effort: 4 })
      .toBuffer();

    await fs.promises.writeFile(outputPath, processedBuffer);

    const originalSize = buffer.length;
    const compressedSize = processedBuffer.length;
    const savedRatio = originalSize > 0 ? Math.max(0, (1 - compressedSize / originalSize) * 100) : 0;

    return {
      filename,
      url: `/uploads/${filename}`,
      original_name: originalName,
      original_size_bytes: originalSize,
      compressed_size_bytes: compressedSize,
      saved_percent: `${savedRatio.toFixed(1)}%`,
      width: 320,
      height: 320,
    };
  } finally {
    activeProcessingTasks--;
  }
}

export function handleUploadErrors(err: any, _req: Request, res: Response, next: NextFunction) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error_code: 'FILE_TOO_LARGE',
        message: 'Image file exceeds the maximum allowed size.',
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        error_code: 'TOO_MANY_FILES',
        message: 'Too many files uploaded in a single batch.',
      });
    }
  }

  if (err?.message === 'INVALID_FILE_TYPE') {
    return res.status(400).json({
      error_code: 'INVALID_FILE_TYPE',
      message: 'Unsupported image format. Accepted formats: JPG, PNG, WebP.',
    });
  }

  if (err?.message === 'SYSTEM_OVERLOADED') {
    return res.status(503).json({
      error_code: 'SYSTEM_OVERLOADED',
      message: 'Image optimizer is busy. Please retry shortly.',
    });
  }

  next(err);
}
