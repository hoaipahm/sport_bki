export interface PriceRule {
  id?: string;
  court_id?: string | null;
  court_type?: string | null;
  day_of_week?: number | null;
  is_weekend?: boolean;
  is_holiday?: boolean;
  valid_from?: string | null;
  valid_to?: string | null;
  start_time: string;
  end_time: string;
  price_per_hour: string | number;
  is_peak_hour?: boolean;
  priority?: number;
}

export interface CancellationRule {
  hours_before: number;
  refund_percent: number;
}

export interface DealRule {
  id: string;
  title_vi: string;
  title_en: string;
  sport_code?: string | null;
  court_ids?: string[];
  days_of_week?: number[];
  time_from: string;
  time_to: string;
  kind: 'OFFPEAK' | 'LAST_MINUTE';
  discount_type: 'PERCENT' | 'FIXED_VND';
  discount_value: number | string;
  floor_price_vnd: number | string;
  lead_hours?: number;
  valid_from?: string | null;
  valid_to?: string | null;
}

export function vietnamDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
}

export function vietnamTime(date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function resolvePrice(
  rules: PriceRule[],
  courtId: string,
  courtType: string,
  date: string,
  time: string,
  isHoliday = false
): number | null {
  const day = new Date(`${date}T12:00:00+07:00`).getUTCDay();
  const sorted = [...rules].sort((a, b) => (Number(b.priority ?? 0) - Number(a.priority ?? 0)));
  const rule = sorted.find(item =>
    (!item.court_id || item.court_id === courtId) &&
    (!item.court_type || item.court_type === courtType) &&
    (item.day_of_week == null || item.day_of_week === day) &&
    (!item.is_weekend || day === 0 || day === 6) &&
    (!item.is_holiday || isHoliday) &&
    (!item.valid_from || date >= String(item.valid_from).slice(0, 10)) &&
    (!item.valid_to || date <= String(item.valid_to).slice(0, 10)) &&
    time >= item.start_time.slice(0, 5) &&
    time < item.end_time.slice(0, 5)
  );
  const amount = rule ? Number(rule.price_per_hour) : NaN;
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

export function resolveDealPrice(
  baseHourly: number,
  deals: DealRule[] | undefined,
  courtId: string,
  sportCode: string | undefined,
  date: string,
  time: string,
  slotStartMs: number,
  nowMs = Date.now()
): { finalHourly: number; deal: DealRule | null } {
  if (!Array.isArray(deals) || deals.length === 0 || baseHourly <= 0) {
    return { finalHourly: baseHourly, deal: null };
  }
  const dow = new Date(`${date}T12:00:00+07:00`).getUTCDay();
  const hoursUntilSlot = (slotStartMs - nowMs) / 3600000;
  let bestHourly = baseHourly;
  let bestDeal: DealRule | null = null;

  for (const d of deals) {
    if (d.valid_from && date < d.valid_from) continue;
    if (d.valid_to && date > d.valid_to) continue;
    if (d.sport_code && sportCode && d.sport_code.toLowerCase() !== sportCode.toLowerCase()) continue;
    if (Array.isArray(d.court_ids) && d.court_ids.length > 0 && !d.court_ids.includes(courtId)) continue;
    if (Array.isArray(d.days_of_week) && d.days_of_week.length > 0 && !d.days_of_week.includes(dow)) continue;
    if (time < d.time_from.slice(0, 5) || time >= d.time_to.slice(0, 5)) continue;
    if (d.kind === 'LAST_MINUTE' && hoursUntilSlot > Number(d.lead_hours ?? 6)) continue;

    const raw =
      d.discount_type === 'PERCENT'
        ? Math.round(baseHourly * (1 - Number(d.discount_value) / 100))
        : baseHourly - Number(d.discount_value);
    const clamped = Math.min(baseHourly, Math.max(Number(d.floor_price_vnd || 0), raw));
    if (clamped < bestHourly) {
      bestHourly = clamped;
      bestDeal = d;
    }
  }
  return { finalHourly: bestHourly, deal: bestDeal };
}

export function calculateRefundPolicy(
  rules: CancellationRule[] | null | undefined,
  startAt: Date | string,
  paidAmount: number,
  now = new Date()
): { hoursBefore: number; refundPercent: number; refundableAmount: number; forfeitedAmount: number } {
  const startMs = new Date(startAt).getTime();
  const hoursBefore = Math.max(0, (startMs - now.getTime()) / (1000 * 60 * 60));
  const defaultRules: CancellationRule[] = [
    { hours_before: 24, refund_percent: 100 },
    { hours_before: 12, refund_percent: 50 },
    { hours_before: 0, refund_percent: 0 },
  ];
  const activeRules = Array.isArray(rules) && rules.length > 0 ? rules : defaultRules;
  const sorted = [...activeRules].sort((a, b) => Number(b.hours_before) - Number(a.hours_before));
  const matched = sorted.find(r => hoursBefore >= Number(r.hours_before));
  const refundPercent = matched ? Math.min(100, Math.max(0, Number(matched.refund_percent))) : 0;
  const safePaid = Math.max(0, Math.round(Number(paidAmount) || 0));
  const refundableAmount = Math.round((safePaid * refundPercent) / 100);
  return {
    hoursBefore: Math.round(hoursBefore * 10) / 10,
    refundPercent,
    refundableAmount,
    forfeitedAmount: safePaid - refundableAmount,
  };
}
