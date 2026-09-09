'use client'

import { AlertCircle, Loader2 } from 'lucide-react'

export function ScoreRing({ score }: { score: number }) {
  const SCORE_MIN = 300
  const SCORE_MAX = 850
  const radius = 78
  const circumference = 2 * Math.PI * radius
  // Progress is fraction of the 300–850 range, never outside [0, 1]
  const fraction = Math.min(1, Math.max(0, (score - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)))
  const progress = circumference - fraction * circumference

  return (
    <div className="score-ring" aria-label={`Credit score ${score}`}>
      <svg viewBox="0 0 190 190" aria-hidden="true">
        <circle className="ring-track" cx="95" cy="95" r={radius} />
        <circle className="ring-progress" cx="95" cy="95" r={radius} style={{ strokeDasharray: circumference, strokeDashoffset: progress }} />
      </svg>
      <div className="score-copy">
        <span className="score-number">{score}</span>
        <span className="score-label">Credit score</span>
      </div>
    </div>
  )
}

export function LoadingSpinner({ size = 24 }: { size?: number }) {
  return <Loader2 className="spin" size={size} />
}

export function ErrorBanner({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="error-banner">
      <AlertCircle size={16} />
      <span>{error}</span>
      <button className="text-button" onClick={onRetry}>Retry</button>
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="empty-state">
      <AlertCircle size={32} />
      <p>{message}</p>
    </div>
  )
}