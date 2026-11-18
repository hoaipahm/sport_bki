import { Response } from 'express';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

class RealtimeCalendarBus extends EventEmitter {}
export const calendarBus = new RealtimeCalendarBus();
calendarBus.setMaxListeners(500);

export interface CourtUpdateEvent {
  event_id?: string;
  venue_id: string;
  court_id: string;
  booking_id?: string;
  booking_code?: string;
  start_at: string;
  end_at: string;
  status: 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED' | 'NO_SHOW' | 'BLOCKED';
  timestamp: string;
}

/**
 * Broadcast court status change to all connected clients.
 * Public streams receive only safe occupancy projection (F-11).
 */
export function broadcastCourtChange(event: CourtUpdateEvent) {
  const enriched: CourtUpdateEvent = {
    ...event,
    event_id: event.event_id || randomUUID(),
  };
  calendarBus.emit(`venue:${enriched.venue_id}`, enriched);
  calendarBus.emit('all_venues', enriched);
}

/**
 * Attach Server-Sent Events (SSE) stream to an Express response.
 * When includePrivateMeta=false (public/customer), strips booking_id and booking_code (F-11).
 */
export function attachSseStream(res: Response, venueId?: string, includePrivateMeta = false) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`);

  const eventName = venueId ? `venue:${venueId}` : 'all_venues';

  const listener = (data: CourtUpdateEvent) => {
    const payload = includePrivateMeta
      ? data
      : {
          event_id: data.event_id,
          venue_id: data.venue_id,
          court_id: data.court_id,
          start_at: data.start_at,
          end_at: data.end_at,
          status: data.status,
          timestamp: data.timestamp,
        };
    res.write(`id: ${data.event_id || Date.now()}\nevent: court_update\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  calendarBus.on(eventName, listener);

  const pingInterval = setInterval(() => {
    res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  }, 20000);

  res.on('close', () => {
    clearInterval(pingInterval);
    calendarBus.off(eventName, listener);
  });
}
