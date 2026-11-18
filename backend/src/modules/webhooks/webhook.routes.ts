import { Router, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { processBankPaymentEvent } from '../booking/booking.service';

export const webhookRouter = Router();

/**
 * POST /webhooks/bank/:provider
 * Idempotent Bank Webhook (Section 7, Section 24.5, Mục 4)
 * Handles VietQR transfer notifications from SePay, Casso, payOS via trusted adapter secret.
 */
webhookRouter.post('/bank/:provider', async (req: Request, res: Response) => {
  const secret = process.env.BANK_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).json({ error_code: 'WEBHOOK_NOT_CONFIGURED' });
  }

  const supplied = Buffer.from(req.get('x-webhook-secret') || '');
  const expected = Buffer.from(secret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ error_code: 'INVALID_WEBHOOK_SIGNATURE' });
  }

  const provider = String(req.params.provider || 'adapter').toLowerCase();
  const payload = req.body || {};

  const eventId = String(payload.id || payload.event_id || payload.transaction_id || '').trim();
  const transferNote = String(payload.content || payload.description || payload.transferContent || '');
  const transferAmount = Number(payload.amount ?? payload.transferAmount);

  if (!eventId || !Number.isSafeInteger(transferAmount) || transferAmount <= 0) {
    return res.status(400).json({ error_code: 'INVALID_PAYMENT_EVENT' });
  }

  try {
    const result = await processBankPaymentEvent({
      provider,
      eventId,
      transferNote,
      transferAmount,
      rawPayload: payload,
      ipAddress: req.ip,
    });

    return res.status(200).json({
      status: result.outcome,
      ...result,
    });
  } catch (err: any) {
    console.error('[Webhook Error]', err.code || err.message);
    return res.status(500).json({ status: 'ERROR', error_code: 'WEBHOOK_PROCESSING_FAILED' });
  }
});
