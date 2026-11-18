'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Star,
  Eye,
  EyeOff,
  Trash2,
  MessageSquare,
  CheckCircle2,
  Send,
  RefreshCw,
} from 'lucide-react';
import { adminApi } from '../../lib/api';

interface AdminReviewsManagerProps {
  token: string;
  language: string;
  venues: Array<{ id: string; name: string }>;
  onNotify: (ok: boolean, msg: string) => void;
}

export function AdminReviewsManager({
  token,
  language,
  venues,
  onNotify,
}: AdminReviewsManagerProps) {
  const isEn = language === 'en';
  const [venueFilter, setVenueFilter] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'visible' | 'hidden'>('all');
  const [stats, setStats] = useState<{
    total_count: number;
    visible_count: number;
    hidden_count: number;
    avg_rating: number | null;
  }>({
    total_count: 0,
    visible_count: 0,
    hidden_count: 0,
    avg_rating: null,
  });
  const [reviews, setReviews] = useState<any[]>([]);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadReviews = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (venueFilter) params.set('venue_id', venueFilter);
      if (visibilityFilter !== 'all') params.set('visibility', visibilityFilter);
      const res = await fetch(`${adminApi}/reviews?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}`, 'Accept-Language': language },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.stats) setStats(data.stats);
        const list = data.reviews || [];
        setReviews(list);
        const drafts: Record<string, string> = {};
        for (const r of list) {
          drafts[r.id] = r.owner_reply || '';
        }
        setReplyDrafts(drafts);
      }
    } finally {
      setLoading(false);
    }
  }, [token, language, venueFilter, visibilityFilter]);

  useEffect(() => {
    void loadReviews();
  }, [loadReviews]);

  const toggleVisibility = async (rev: any) => {
    setBusyId(rev.id);
    try {
      const nextVis = !rev.is_visible;
      const res = await fetch(`${adminApi}/reviews/${rev.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Accept-Language': language,
        },
        body: JSON.stringify({ is_visible: nextVis }),
      });
      if (res.ok) {
        onNotify(
          true,
          nextVis
            ? 'Đã duyệt hiển thị đánh giá công khai trên trang sân.'
            : 'Đã tạm ẩn đánh giá khỏi trang công khai.'
        );
        await loadReviews();
      } else {
        onNotify(false, 'Không thể cập nhật trạng thái hiển thị.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const saveReply = async (revId: string) => {
    setBusyId(revId);
    try {
      const res = await fetch(`${adminApi}/reviews/${revId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Accept-Language': language,
        },
        body: JSON.stringify({ owner_reply: replyDrafts[revId] || '' }),
      });
      if (res.ok) {
        onNotify(true, 'Đã lưu phản hồi của Chủ sân!');
        await loadReviews();
      } else {
        onNotify(false, 'Không thể lưu phản hồi.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const deleteReview = async (revId: string) => {
    setBusyId(revId);
    try {
      const res = await fetch(`${adminApi}/reviews/${revId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        onNotify(true, 'Đã xóa đánh giá vĩnh viễn.');
        await loadReviews();
      } else {
        onNotify(false, 'Không thể xóa đánh giá.');
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="tab-panel-anim space-y-6">
      {/* KPI Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums">
        <div className="bg-panel border border-borderStrong rounded-token-lg p-5">
          <span className="text-xs text-textMuted block">
            {isEn ? 'Public Avg Rating' : 'Điểm Sao Công Khai'}
          </span>
          <strong className="text-2xl sm:text-3xl font-extrabold text-statusWarning mt-1 flex items-center gap-1.5">
            <span>{stats.avg_rating ? stats.avg_rating.toFixed(1) : '—'}</span>
            <Star className="w-6 h-6 fill-current" />
          </strong>
        </div>
        <div className="bg-panel border border-borderStrong rounded-token-lg p-5">
          <span className="text-xs text-textMuted block">
            {isEn ? 'Total Reviews' : 'Tổng Số Đánh Giá'}
          </span>
          <strong className="text-2xl sm:text-3xl font-extrabold text-textStrong mt-1 block">
            {stats.total_count}
          </strong>
        </div>
        <div className="bg-panel border border-borderStrong rounded-token-lg p-5">
          <span className="text-xs text-textMuted block">
            {isEn ? 'Visible Publicly' : 'Đang Hiển Thị'}
          </span>
          <strong className="text-2xl sm:text-3xl font-extrabold text-accent mt-1 block">
            {stats.visible_count}
          </strong>
        </div>
        <div className="bg-panel border border-borderStrong rounded-token-lg p-5">
          <span className="text-xs text-textMuted block">
            {isEn ? 'Hidden / Moderated' : 'Đang Tạm Ẩn'}
          </span>
          <strong className="text-2xl sm:text-3xl font-extrabold text-textBody mt-1 block">
            {stats.hidden_count}
          </strong>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-panel border border-borderStrong rounded-token-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={venueFilter}
            onChange={(e) => setVenueFilter(e.target.value)}
            className="min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-sm text-textStrong"
          >
            <option value="">{isEn ? 'All Venues' : 'Tất cả cơ sở sân'}</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1.5">
            {(
              [
                { id: 'all', label: isEn ? 'All' : 'Tất cả' },
                { id: 'visible', label: isEn ? 'Visible' : 'Đang hiển thị' },
                { id: 'hidden', label: isEn ? 'Hidden' : 'Đang ẩn' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setVisibilityFilter(f.id)}
                className={`min-h-[40px] px-3.5 rounded-token-full text-xs font-bold border ${
                  visibilityFilter === f.id
                    ? 'bg-accent text-textOnAccent border-accent'
                    : 'bg-panel-2 text-textBody border-borderToken hover:text-textStrong'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void loadReviews()}
          className="min-h-[40px] px-3.5 rounded-token-md bg-panel-2 hover:bg-surfaceHover border border-borderStrong text-xs font-semibold text-textStrong inline-flex items-center gap-1.5"
        >
          <RefreshCw className={`w-4 h-4 text-accent ${loading ? 'animate-spin' : ''}`} />
          <span>{isEn ? 'Refresh' : 'Làm mới'}</span>
        </button>
      </div>

      {/* Review Moderation List */}
      {loading ? (
        <div className="h-40 rounded-token-lg skeleton-shimmer border border-borderToken" />
      ) : reviews.length === 0 ? (
        <div className="bg-panel border border-borderStrong rounded-token-lg p-10 text-center space-y-2">
          <MessageSquare className="w-8 h-8 text-accent mx-auto" />
          <p className="font-bold text-textStrong">
            {isEn ? 'No customer reviews match this filter yet.' : 'Chưa có đánh giá nào khớp bộ lọc hiện tại.'}
          </p>
          <p className="text-xs text-textMuted">
            {isEn
              ? 'Customer star ratings and comments submitted on venue pages appear here immediately.'
              : 'Khi khách hàng gửi chấm sao và bình luận trên trang cơ sở, đánh giá sẽ xuất hiện ngay tại đây.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((rev) => {
            const isBusy = busyId === rev.id;
            return (
              <div
                key={rev.id}
                className={`bg-panel rounded-token-lg p-5 sm:p-6 border space-y-4 ${
                  rev.is_visible ? 'border-borderStrong' : 'border-statusWarning-border opacity-85'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {rev.author_avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={rev.author_avatar}
                        alt=""
                        className="w-10 h-10 rounded-token-full object-cover border border-accent-border shrink-0"
                      />
                    ) : (
                      <span className="w-10 h-10 rounded-token-full bg-accent-soft border border-accent-border text-accent font-extrabold text-sm flex items-center justify-center shrink-0">
                        {(rev.author_name || 'K').charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm sm:text-base font-bold text-textStrong">
                          {rev.author_name}
                        </strong>
                        <span className="px-2.5 py-0.5 rounded-token-full bg-panel-2 border border-borderToken text-xs font-semibold text-textStrong">
                          {rev.venue_name}
                        </span>
                        {rev.booking_code && (
                          <span className="px-2.5 py-0.5 rounded-token-full bg-accent-soft border border-accent-border text-accent text-xs font-bold inline-flex items-center gap-1 tabular-nums">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Mã vé: {rev.booking_code}</span>
                          </span>
                        )}
                        <span
                          className={`px-2.5 py-0.5 rounded-token-full text-[11px] font-bold ${
                            rev.is_visible
                              ? 'bg-accent-soft text-accent border border-accent-border'
                              : 'bg-statusWarning-soft text-statusWarning border border-statusWarning-border'
                          }`}
                        >
                          {rev.is_visible ? 'ĐANG HIỂN THỊ' : 'ĐANG ẨN'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star
                              key={s}
                              className={`w-4 h-4 ${
                                s <= rev.rating ? 'text-statusWarning fill-current' : 'text-textMuted'
                              }`}
                            />
                          ))}
                        </div>
                        <span className="text-xs text-textMuted tabular-nums">
                          · {new Date(rev.created_at).toLocaleString('vi-VN')}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Duyệt / Ẩn & Xóa */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void toggleVisibility(rev)}
                      className={`min-h-[38px] px-3.5 rounded-token-full text-xs font-bold inline-flex items-center gap-1.5 border ${
                        rev.is_visible
                          ? 'bg-panel-2 text-statusWarning border-statusWarning-border hover:bg-surfaceHover'
                          : 'bg-accent text-textOnAccent border-accent'
                      }`}
                    >
                      {rev.is_visible ? (
                        <>
                          <EyeOff className="w-3.5 h-3.5" />
                          <span>Ẩn đánh giá</span>
                        </>
                      ) : (
                        <>
                          <Eye className="w-3.5 h-3.5" />
                          <span>Duyệt hiển thị</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void deleteReview(rev.id)}
                      title="Xóa đánh giá"
                      className="min-h-[38px] px-3 rounded-token-full bg-statusDanger-soft border border-statusDanger-border text-statusDanger text-xs font-semibold inline-flex items-center gap-1 hover:bg-statusDanger hover:text-textOnAccent"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Xóa</span>
                    </button>
                  </div>
                </div>

                <p className="text-sm text-textBody bg-panel-2 rounded-token-md p-3.5 border border-borderToken whitespace-pre-line">
                  {rev.comment}
                </p>

                {/* Inline Owner Reply Box */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
                  <input
                    type="text"
                    value={replyDrafts[rev.id] ?? ''}
                    onChange={(e) =>
                      setReplyDrafts((prev) => ({ ...prev, [rev.id]: e.target.value }))
                    }
                    placeholder="Nhập phản hồi của Chủ sân cho đánh giá này (bỏ trống để xóa phản hồi)..."
                    className="flex-1 min-h-[42px] px-3.5 rounded-token-md bg-panel-2 border border-borderStrong text-xs sm:text-sm text-textStrong placeholder:text-textMuted outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void saveReply(rev.id)}
                    className="min-h-[42px] px-4 rounded-token-full bg-accent text-textOnAccent text-xs font-bold inline-flex items-center justify-center gap-1.5 shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Lưu Phản Hồi</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
