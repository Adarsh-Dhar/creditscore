'use client'

import { useMemo, useState } from 'react'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  ChevronDown,
  CircleHelp,
  Copy,
  ExternalLink,
  LayoutDashboard,
  Menu,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trophy,
  Wallet,
  X,
  Zap,
} from 'lucide-react'

const factors = [
  { name: 'Repayment history', value: 96, score: '+32', tone: 'mint' },
  { name: 'Credit utilization', value: 78, score: '+18', tone: 'gold' },
  { name: 'Account age', value: 64, score: '+12', tone: 'blue' },
  { name: 'Portfolio diversity', value: 52, score: '+8', tone: 'peach' },
]

const activity = [
  { title: 'Loan repaid', detail: 'Arcade lending pool', date: 'Today, 09:42', points: '+18', icon: ArrowUpRight, color: 'mint' },
  { title: 'Payment received', detail: 'USDC · 1,240.00', date: 'Yesterday, 14:08', points: '+6', icon: Wallet, color: 'gold' },
  { title: 'Credit check', detail: 'Verified protocol request', date: 'Jun 18, 2024', points: '0', icon: ShieldCheck, color: 'blue' },
]

const navItems = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Activity', icon: Activity },
  { label: 'Leaderboard', icon: Trophy },
]

function ScoreRing({ score }: { score: number }) {
  const radius = 78
  const circumference = 2 * Math.PI * radius
  const progress = circumference - (score / 850) * circumference

  return (
    <div className="score-ring" aria-label={`Credit score ${score} out of 850`}>
      <svg viewBox="0 0 190 190" aria-hidden="true">
        <circle className="ring-track" cx="95" cy="95" r={radius} />
        <circle className="ring-progress" cx="95" cy="95" r={radius} style={{ strokeDasharray: circumference, strokeDashoffset: progress }} />
      </svg>
      <div className="score-copy">
        <span className="score-number">{score}</span>
        <span className="score-label">Excellent</span>
      </div>
    </div>
  )
}

export default function Page() {
  const [activeNav, setActiveNav] = useState('Overview')
  const [query, setQuery] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [refreshed, setRefreshed] = useState(false)

  const visibleActivity = useMemo(() => {
    if (!query.trim()) return activity
    return activity.filter((item) => `${item.title} ${item.detail}`.toLowerCase().includes(query.toLowerCase()))
  }, [query])

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><Sparkles size={17} /></div>
          <span className="brand-name">credit<span>score</span></span>
          <button className="icon-button mobile-close" aria-label="Close menu" onClick={() => setMobileOpen(false)}><X size={18} /></button>
        </div>
        <div className="network-pill"><span className="network-dot" /> Base network <ChevronDown size={14} /></div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navItems.map(({ label, icon: Icon }) => (
            <button key={label} className={`nav-item ${activeNav === label ? 'nav-item-active' : ''}`} onClick={() => { setActiveNav(label); setMobileOpen(false) }}>
              <Icon size={18} /> {label}
              {label === 'Activity' && <span className="nav-count">3</span>}
            </button>
          ))}
          <p className="nav-label nav-label-spaced">Manage</p>
          <button className="nav-item" onClick={() => setActiveNav('Settings')}><Settings2 size={18} /> Settings</button>
          <button className="nav-item" onClick={() => setActiveNav('Help')}><CircleHelp size={18} /> Help center</button>
        </nav>
        <div className="sidebar-bottom">
          <div className="protocol-card"><div className="protocol-icon"><Zap size={16} /></div><div><strong>Protocol status</strong><span><i /> All systems operational</span></div></div>
          <div className="profile-row"><div className="avatar">JD</div><div className="profile-info"><strong>Jordan Davis</strong><span>0x71...9A42</span></div><ChevronDown size={16} /></div>
        </div>
      </aside>

      {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}

      <section className="content-area">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><div><p className="eyebrow">Tuesday, June 25, 2024</p><h1>{activeNav === 'Overview' ? 'Good morning, Jordan' : activeNav}</h1></div></div>
          <div className="topbar-actions"><label className="search-box"><Search size={16} /><input aria-label="Search activity" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search wallet or activity" /></label><button className="icon-button notification" aria-label="Notifications"><Bell size={18} /><span /></button><button className="wallet-button"><span className="wallet-avatar">JD</span><span>0x71...9A42</span><ChevronDown size={15} /></button></div>
        </header>

        <div className="dashboard-content">
          <div className="status-banner"><div className="status-icon"><ShieldCheck size={19} /></div><div><strong>Your identity is verified</strong><span>Your credit score is actively contributing to protocol trust.</span></div><button className="banner-link">View verification <ExternalLink size={14} /></button></div>

          <div className="dashboard-grid">
            <section className="panel score-panel"><div className="panel-header"><div><p className="eyebrow">Your credit score</p><h2>On-chain reputation</h2></div><button className="refresh-button" aria-label="Refresh score" onClick={() => { setRefreshed(true); window.setTimeout(() => setRefreshed(false), 1200) }}><RefreshCw className={refreshed ? 'spin' : ''} size={16} /> {refreshed ? 'Updated' : 'Refresh'}</button></div><div className="score-main"><ScoreRing score={742} /><div className="score-meta"><div className="score-change"><ArrowUpRight size={17} /><strong>+24</strong><span>since last month</span></div><p>Top 8% of verified wallets</p><div className="score-scale"><span>300</span><div><i /><i /><i /><i className="active" /><i /></div><span>850</span></div></div></div><div className="score-footer"><span><i className="legend-dot mint-dot" /> Excellent standing</span><span>Last calculated 4h ago</span></div></section>

            <section className="panel wallet-panel"><div className="panel-header"><div><p className="eyebrow">Your wallet</p><h2>Identity overview</h2></div><button className="copy-button" aria-label="Copy wallet address" onClick={() => navigator.clipboard?.writeText('0x71a2c4...9A42')}><Copy size={15} /></button></div><div className="wallet-address"><div className="wallet-large-avatar">JD</div><div><strong>0x71a2c4...9A42</strong><span>Base · Connected</span></div></div><div className="wallet-stats"><div><span>Rank</span><strong>#1,248</strong></div><div><span>Percentile</span><strong>92nd</strong></div><div><span>Member since</span><strong>Mar 2023</strong></div></div><button className="outline-button">View public profile <ExternalLink size={14} /></button></section>
          </div>

          <div className="section-heading"><div><p className="eyebrow">Score composition</p><h2>What&apos;s driving your score?</h2></div><button className="text-button">View methodology <ArrowUpRight size={15} /></button></div>
          <section className="panel factors-panel"><div className="factor-intro"><div className="factor-badge"><BarChart3 size={20} /></div><div><h3>Strong fundamentals</h3><p>Consistent repayment and healthy utilization are working in your favor.</p></div><div className="factor-total"><span>Total impact</span><strong>+70</strong></div></div><div className="factor-list">{factors.map((factor) => <div className="factor-row" key={factor.name}><div className="factor-name"><span className={`factor-dot ${factor.tone}`} /><strong>{factor.name}</strong><span className="factor-score">{factor.score}</span></div><div className="progress-track"><div className={`progress-fill ${factor.tone}`} style={{ width: `${factor.value}%` }} /></div><span className="factor-value">{factor.value}%</span></div>)}</div></section>

          <div className="section-heading activity-heading"><div><p className="eyebrow">Your activity</p><h2>Recent events</h2></div><button className="text-button">See all activity <ArrowUpRight size={15} /></button></div>
          <section className="panel activity-panel">{visibleActivity.length ? visibleActivity.map((item) => { const Icon = item.icon; return <div className="activity-row" key={item.title}><div className={`activity-icon ${item.color}`}><Icon size={17} /></div><div className="activity-detail"><strong>{item.title}</strong><span>{item.detail}</span></div><span className="activity-date">{item.date}</span><strong className={`activity-points ${item.points === '0' ? 'neutral' : ''}`}>{item.points}</strong><ArrowDownRight className="activity-arrow" size={16} /></div> }) : <div className="empty-state">No matching activity found.</div>}</section>
          <footer className="page-footer"><span>Powered by transparent on-chain data</span><span>Data refreshes every 4 hours</span></footer>
        </div>
      </section>
    </main>
  )
}
