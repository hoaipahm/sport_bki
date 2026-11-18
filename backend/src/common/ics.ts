/**
 * iCalendar (.ics) Generator for Booking Synchronization (Section 17.2 & BKG-05)
 * Explicit Asia/Ho_Chi_Minh (GMT+7) Timezone
 */

export interface CalendarEventParams {
  bookingCode: string;
  venueName: string;
  venueAddress: string;
  courtName: string;
  startAt: Date;
  endAt: Date;
  customerName: string;
  language?: 'vi' | 'en';
}

function formatIcsDate(date: Date): string {
  // ISO-8601 UTC format e.g. 20261121T120000Z
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

export function generateBookingIcs(params: CalendarEventParams): string {
  const isEn = params.language === 'en';
  const summary = isEn
    ? `Court Booking: ${params.courtName} at ${params.venueName} (Code: ${params.bookingCode})`
    : `Đặt sân: ${params.courtName} tại ${params.venueName} (Mã: ${params.bookingCode})`;

  const description = isEn
    ? `Booking Code: ${params.bookingCode}\\nCourt: ${params.courtName}\\nCustomer: ${params.customerName}\\nAddress: ${params.venueAddress}\\nPlease arrive 10 minutes early and show your QR code.`
    : `Mã đặt sân: ${params.bookingCode}\\nSân: ${params.courtName}\\nKhách hàng: ${params.customerName}\\nĐịa chỉ: ${params.venueAddress}\\nVui lòng đến trước 10 phút và xuất trình mã QR.`;

  const dtStamp = formatIcsDate(new Date());
  const dtStart = formatIcsDate(new Date(params.startAt));
  const dtEnd = formatIcsDate(new Date(params.endAt));

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sports Court Booking Platform//VN//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:booking-${params.bookingCode}@tenmien.vn`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${params.venueAddress}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    `DESCRIPTION:Reminder: Court booking in 2 hours (${params.courtName})`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
