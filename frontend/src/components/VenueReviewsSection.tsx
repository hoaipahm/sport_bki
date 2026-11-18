'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Star,
  CheckCircle2,
  MessageSquare,
  Send,
  Trash2,
  CornerDownRight,
  AlertCircle,
  User,
} from 'lucide-react';
import { customerApi } from '../lib/api';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/Button';

export interface ReviewSummary {
  review_count: number;
  avg_rating: number | null;
  distribution: Record<number, number>;
}

interface PublicReviewItem {
  id: string;
  customer_id: string;
  author_name: string;
  author_avatar?: string | null;
  rating: number;
  comment: string;
  verified_booking?: boolean;
  owner_reply?: string | null;
  replied_at?: string | null;
  created_at: string;
  updated_at?: string;
}

interface VenueReviewsSectionProps {
  venueId: string;
  onOpenAuthModal: () => void;
  onSummaryUpdated?: (summary: ReviewSummary) => void;
}

const QUICK_TAGS_VI = [
  'Mặt sân rất đẹp',
  'Đèn LED sáng không chói',
  'Chỗ gửi xe rộng rãi',
  'Nhân viên nhiệt tình',
  'Phòng thay đồ sạch sẽ',
];

const QUICK_TAGS_EN = [
  'Great court surface',
  'Bright anti-glare LEDs',
  'Spacious parking',
  'Friendly staff',
  'Clean locker rooms',
];

export function VenueReviewsSection({
  venueId,
  onOpenAuthModal,
  onSummaryUpdated,
}: VenueReviewsSectionProps) {
  const { language, t } = useLanguage();
  const { isAuthenticated, token, authenticatedFetch } = useAuth();

  const [summary, setSummary] = useState<ReviewSummary>({
    review_count: 0,
    avg_rating: null,
    distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
  });
  const [reviews, setReviews] = useState<PublicReviewItem[]>([]);
  const [myReview, setMyReview] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const loadReviews = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${customerApi}/venues/${venueId}/reviews`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.summary) setSummary(data.summary);
        setReviews(data.reviews || []);
        setMyReview(data.my_review || null);
        if (data.my_review) {
          setRating(Number(data.my_review.rating || 5));
          setComment(data.my_review.comment || '');
        } else {
          setRating(5);
          setComment('');
        }
      }
    } finally {
      setLoading(false);
    }
  }, [venueId, token]);

  useEffect(() => {
    setFeedback(null);
    void loadReviews();
  }, [loadReviews]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      onOpenAuthModal();
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await authenticatedFetch(`${customerApi}/venues/${venueId}/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': language,
        },
        body: JSON.stringify({ rating, comment: comment.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, text: data.message || t('common.errorOccurred') });
        return;
      }
      if (data.summary && onSummaryUpdated) {
        onSummaryUpdated(data.summary);
      }
      setFeedback({ ok: true, text: t('reviews.savedToast') });
      await loadReviews();
    } catch {
      setFeedback({ ok: false, text: t('web.networkError') });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMine = async () => {
    if (!myReview?.id) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await authenticatedFetch(
        `${customerApi}/venues/${venueId}/reviews/${myReview.id}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (res.ok) {
        if (data.summary && onSummaryUpdated) {
          onSummaryUpdated(data.summary);
        }
        setMyReview(null);
        setComment('');
        setRating(5);
        setFeedback({ ok: true, text: t('reviews.deletedToast') });
        await loadReviews();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const appendQuickTag = (tag: string) => {
    setComment((prev) => {
      const trimmed = prev.trim();
      if (trimmed.toLowerCase().includes(tag.toLowerCase())) return prev;
      return trimmed ? `${trimmed}. ${tag}` : tag;
    });
  };

  const displayStarVal = hoverRating || rating;
  const starLabels: Record<number, string> = {
    1: t('reviews.star1'),
    2: t('reviews.star2'),
    3: t('reviews.star3'),
    4: t('reviews.star4'),
    5: t('reviews.star5'),
  };

  const quickTags = language === 'en' ? QUICK_TAGS_EN : QUICK_TAGS_VI;

  return (
    <div className="border-t border-borderToken pt-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-extrabold text-lg sm:text-xl text-textStrong flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-accent shrink-0" />
            <span>{t('reviews.title')}</span>
          </h4>
          <p className="text-xs sm:text-sm text-textMuted mt-0.5">{t('reviews.subtitle')}</p>
        </div>
      </div>

      {/* Top Grid: Rating Breakdown + Interactive Composer */}
      <div className="grid grid-cols-1 lg:grid-cols-[0.88fr_1.12fr] gap-5">
        {/* Left: Score Summary & 5-Star Bars */}
        <div className="bg-panel-2 rounded-token-md p-5 border border-borderToken flex flex-col justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="text-center shrink-0">
              <strong className="text-4xl font-extrabold text-textStrong tabular-nums block leading-tight">
                {summary.avg_rating ? summary.avg_rating.toFixed(1) : '—'}
              </strong>
              <div className="flex items-center justify-center gap-0.5 mt-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    className={`w-4 h-4 ${
                      summary.avg_rating && s <= Math.round(summary.avg_rating)
                        ? 'text-statusWarning fill-current'
                        : 'text-textMuted'
                    }`}
                  />
                ))}
              </div>
              <span className="text-xs text-textMuted mt-1 block tabular-nums">
                {summary.review_count} {t('venue.reviews')}
              </span>
            </div>

            <div className="flex-1 space-y-1.5 tabular-nums">
              {[5, 4, 3, 2, 1].map((tier) => {
                const cnt = summary.distribution?.[tier] || 0;
                const pct =
                  summary.review_count > 0 ? Math.round((cnt / summary.review_count) * 100) : 0;
                return (
                  <div key={tier} className="flex items-center gap-2 text-xs">
                    <span className="w-7 font-semibold text-textStrong inline-flex items-center gap-0.5 shrink-0">
                      <span>{tier}</span>
                      <Star className="w-3 h-3 text-statusWarning fill-current" />
                    </span>
                    <div className="flex-1 h-2 rounded-token-full bg-panel overflow-hidden border border-borderToken">
                      <div
                        className="h-full bg-accent rounded-token-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-7 text-right text-textMuted">{cnt}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Customer Star Picker & Review Form */}
        <div className="bg-panel-2 rounded-token-md p-5 border border-borderStrong">
          {!isAuthenticated ? (
            <div className="h-full flex flex-col items-start justify-center gap-3">
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star key={s} className="w-5 h-5 text-statusWarning fill-current" />
                ))}
              </div>
              <p className="text-sm text-textBody">{t('reviews.loginPrompt')}</p>
              <Button size="sm" variant="primary" type="button" onClick={onOpenAuthModal}>
                <User className="w-4 h-4 mr-1.5" />
                <span>{t('reviews.loginBtn')}</span>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-sm text-textStrong">
                  {myReview ? t('reviews.editTitle') : t('reviews.writeTitle')}
                </span>
                <div className="flex items-center gap-1.5">
                  <div
                    className="flex items-center gap-1"
                    onMouseLeave={() => setHoverRating(0)}
                  >
                    {[1, 2, 3, 4, 5].map((star) => {
                      const active = star <= displayStarVal;
                      return (
                        <button
                          key={star}
                          type="button"
                          aria-label={`${star} stars`}
                          onMouseEnter={() => setHoverRating(star)}
                          onClick={() => setRating(star)}
                          className="p-1 rounded-token-sm hover:bg-surfaceHover"
                        >
                          <Star
                            className={`w-6 h-6 ${
                              active ? 'text-statusWarning fill-current' : 'text-textMuted'
                            }`}
                          />
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-xs font-bold text-accent min-w-[76px]">
                    {starLabels[displayStarVal]}
                  </span>
                </div>
              </div>

              {myReview && myReview.is_visible === false && (
                <div className="p-2.5 rounded-token-sm bg-statusWarning-soft border border-statusWarning-border text-statusWarning text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{t('reviews.hiddenByAdminNotice')}</span>
                </div>
              )}

              {/* Quick Tag Suggestions */}
              <div className="flex flex-wrap gap-1.5">
                {quickTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => appendQuickTag(tag)}
                    className="px-2.5 py-1 rounded-token-full bg-panel hover:bg-surfaceHover border border-borderToken text-xs text-textBody hover:text-textStrong"
                  >
                    + {tag}
                  </button>
                ))}
              </div>

              <textarea
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={1000}
                required
                placeholder={t('reviews.placeholder')}
                className="w-full p-3 rounded-token-md bg-panel border border-borderStrong text-sm text-textStrong placeholder:text-textMuted outline-none focus:border-accent"
              />

              {feedback && (
                <p
                  role="status"
                  className={`text-xs font-semibold flex items-center gap-1.5 ${
                    feedback.ok ? 'text-accent' : 'text-statusDanger'
                  }`}
                >
                  {feedback.ok ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{feedback.text}</span>
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={submitting || comment.trim().length < 2}
                >
                  <Send className="w-3.5 h-3.5 mr-1.5" />
                  <span>{myReview ? t('reviews.updateBtn') : t('reviews.submitBtn')}</span>
                </Button>

                {myReview && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleDeleteMine}
                    className="min-h-[36px] px-3 rounded-token-full bg-statusDanger-soft border border-statusDanger-border text-statusDanger text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t('reviews.deleteBtn')}</span>
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Public Reviews Feed */}
      {loading ? (
        <div className="h-24 rounded-token-md skeleton-shimmer border border-borderToken" />
      ) : reviews.length === 0 ? (
        <p className="text-sm text-textMuted bg-panel-2/60 rounded-token-md p-4 border border-borderToken">
          {t('reviews.noReviewsYet')}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {reviews.map((rev) => {
            const initial = (rev.author_name || 'K').trim().charAt(0).toUpperCase();
            return (
              <div
                key={rev.id}
                className="bg-panel-2 rounded-token-md p-4 border border-borderToken space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {rev.author_avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={rev.author_avatar}
                          alt={rev.author_name}
                          className="w-9 h-9 rounded-token-full object-cover border border-accent-border shrink-0"
                        />
                      ) : (
                        <span className="w-9 h-9 rounded-token-full bg-accent-soft border border-accent-border text-accent font-extrabold text-sm flex items-center justify-center shrink-0">
                          {initial}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <strong className="text-sm font-bold text-textStrong truncate">
                            {rev.author_name}
                          </strong>
                          {rev.verified_booking && (
                            <span className="px-2 py-0.5 rounded-token-full bg-accent-soft border border-accent-border text-accent text-[11px] font-bold inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>{t('reviews.verifiedPlayer')}</span>
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-textMuted block tabular-nums">
                          {new Date(rev.created_at).toLocaleDateString(
                            language === 'en' ? 'en-US' : 'vi-VN'
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className={`w-3.5 h-3.5 ${
                            s <= rev.rating ? 'text-statusWarning fill-current' : 'text-textMuted'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  <p className="text-sm text-textBody leading-relaxed whitespace-pre-line">
                    {rev.comment}
                  </p>
                </div>

                {rev.owner_reply && (
                  <div className="p-3 rounded-token-sm bg-panel border border-accent-border space-y-1">
                    <p className="text-xs font-bold text-accent flex items-center gap-1.5">
                      <CornerDownRight className="w-3.5 h-3.5 shrink-0" />
                      <span>{t('reviews.ownerReplyLabel')}</span>
                    </p>
                    <p className="text-xs sm:text-sm text-textStrong leading-relaxed">
                      {rev.owner_reply}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
