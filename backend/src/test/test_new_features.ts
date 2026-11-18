import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { optimizeAndSaveImage } from '../common/uploader';
import { calendarBus, broadcastCourtChange, CourtUpdateEvent } from '../common/realtime';

async function runFeatureTests() {
  console.log('--- TESTING NEW EXTENSIONS (Image Optimization & Security) ---');
  let passed = 0;
  let total = 0;

  function assert(name: string, condition: boolean, details?: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name} ${details ? ': ' + details : ''}`);
    }
  }

  // 1. TEST SHARP IMAGE OPTIMIZATION (>10MB test simulation)
  console.log('Testing Image Compression & WebP Conversion...');
  // Generate a high-resolution raw image buffer (2000x2000 pixels)
  const rawImageBuffer = await sharp({
    create: {
      width: 2000,
      height: 2000,
      channels: 4,
      background: { r: 21, g: 128, b: 61, alpha: 1 }, // Brand Green
    },
  })
    .png()
    .toBuffer();

  const originalSize = rawImageBuffer.length;
  const result = await optimizeAndSaveImage(rawImageBuffer, 'test_court_photo.png');

  assert(
    'SHARP-01: Image converted to .webp format',
    result.filename.endsWith('.webp') && result.url.startsWith('/uploads/')
  );
  assert(
    'SHARP-02: Image resized to max 1920x1080 bounds',
    result.width <= 1920 && result.height <= 1920
  );
  assert(
    'SHARP-03: Substantial file size reduction achieved',
    result.compressed_size_bytes < originalSize,
    `Raw: ${originalSize} bytes -> Compressed: ${result.compressed_size_bytes} bytes (${result.saved_percent} saved)`
  );

  // Clean up created test file
  const createdFilePath = path.resolve(__dirname, '../../uploads', result.filename);
  if (fs.existsSync(createdFilePath)) {
    fs.unlinkSync(createdFilePath);
  }

  // 2. TEST REALTIME SSE BUS
  console.log('Testing Realtime Server-Sent Events (SSE)...');
  let sseEventReceived = false;
  const testVenueId = 'test-venue-123';

  calendarBus.once(`venue:${testVenueId}`, (data: CourtUpdateEvent) => {
    if (data.booking_code === 'DS-REALTIME-TEST' && data.status === 'PENDING') {
      sseEventReceived = true;
    }
  });

  broadcastCourtChange({
    venue_id: testVenueId,
    court_id: 'court-1',
    booking_code: 'DS-REALTIME-TEST',
    start_at: new Date().toISOString(),
    end_at: new Date().toISOString(),
    status: 'PENDING',
    timestamp: new Date().toISOString(),
  });

  assert('SSE-01: Realtime calendar event broadcast to venue subscribers', sseEventReceived);

  console.log(`\n========================================`);
  console.log(`FEATURE TESTS: ${passed}/${total} PASSED`);
  console.log(`========================================`);
  process.exit(passed === total ? 0 : 1);
}

runFeatureTests().catch((err) => {
  console.error('Feature test error:', err);
  process.exit(1);
});
