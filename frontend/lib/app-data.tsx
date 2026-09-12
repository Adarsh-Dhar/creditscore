'use client'

import { createContext, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { ArrowDownRight, ArrowUpRight, Activity as ActivityIcon, AlertCircle } from 'lucide-react'
import { useWallet } from './wallet'
import {
  walletSummary,
  walletEvents,
  leaderboard,
  chainsStatus,
  registerWallet,
  type WalletSummary,
  type IndexedEvent,
  type LeaderboardEntry,
  type ChainStatus,
  ApiError,
} from './api'

type LoadingState = {
  summary: boolean
  events: boolean
  leaderboard: boolean
  chains: boolean
}

type ErrorState = {
  summary: string | null
  events: string | null
  leaderboard: string | null
  chains: string | null
}

interface AppDataContextValue {
  // wallet connection
  walletAddress: string | null
  isConnected: boolean
  isConnecting: boolean
  walletError: string | null
  connect: () => void
  disconnect: () => void

  // search / current address
  query: string
  setQuery: Dispatch<SetStateAction<string>>
  handleSearch: () => void
  currentAddress: string | null

  // data
  summary: WalletSummary | null
  events: IndexedEvent[]
  leaderboardData: LeaderboardEntry[]
  chainsData: ChainStatus[]

  loading: LoadingState
  errors: ErrorState

  // activity filters
  eventPage: number
  setEventPage: Dispatch<SetStateAction<number>>
  eventPageSize: number
  setEventPageSize: Dispatch<SetStateAction<number>>
  eventFilter: string | null
  setEventFilter: Dispatch<SetStateAction<string | null>>
  protocolFilter: string | null
  setProtocolFilter: Dispatch<SetStateAction<string | null>>
  totalEvents: number

  // network
  selectedChain: string
  setSelectedChain: Dispatch<SetStateAction<string>>

  // actions
  loadWalletData: (address: string) => Promise<void>
  loadLeaderboard: () => Promise<void>
  handleRefresh: () => void
  getBlockExplorerUrl: (chain: string, address: string) => string
  getTxExplorerUrl: (chain: string, txHash: string) => string

  // derived
  rankInfo: { rank: number; percentile: number } | null
  maxScore: number
  eventIcons: Record<string, any>
  eventColors: Record<string, string>
  protocolColors: Record<string, string>
}

const AppDataContext = createContext<AppDataContextValue | null>(null)

const eventIcons: Record<string, any> = {
  Supply: ArrowUpRight,
  Borrow: ArrowDownRight,
  Repay: ArrowUpRight,
  Withdraw: ArrowDownRight,
  LiquidationCall: AlertCircle,
}

const eventColors: Record<string, string> = {
  Supply: 'mint',
  Borrow: 'gold',
  Repay: 'mint',
  Withdraw: 'blue',
  LiquidationCall: 'peach',
}

const protocolColors: Record<string, string> = {
  aave: 'mint',
  compound: 'gold',
  morpho: 'blue',
  liquity: 'peach',
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { address: walletAddress, isConnected, isConnecting, error: walletError, connect, disconnect } = useWallet()

  const [query, setQuery] = useState('')
  const [searchAddress, setSearchAddress] = useState('')
  const [currentAddress, setCurrentAddress] = useState<string | null>(null)

  const [summary, setSummary] = useState<WalletSummary | null>(null)
  const [events, setEvents] = useState<IndexedEvent[]>([])
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardEntry[]>([])
  const [chainsData, setChainsData] = useState<ChainStatus[]>([])

  const [loading, setLoading] = useState<LoadingState>({
    summary: false,
    events: false,
    leaderboard: false,
    chains: false,
  })
  const [errors, setErrors] = useState<ErrorState>({
    summary: null,
    events: null,
    leaderboard: null,
    chains: null,
  })

  const [eventPage, setEventPage] = useState(1)
  const [eventPageSize, setEventPageSize] = useState(10)
  const [eventFilter, setEventFilter] = useState<string | null>(null)
  const [protocolFilter, setProtocolFilter] = useState<string | null>(null)
  const [totalEvents, setTotalEvents] = useState(0)

  const [selectedChain, setSelectedChain] = useState('sepolia')

  const getBlockExplorerUrl = (chain: string, address: string) => {
    const explorers: Record<string, string> = {
      ethereum: `https://etherscan.io/address/${address}`,
      sepolia: `https://sepolia.etherscan.io/address/${address}`,
      'cc3 testnet': `https://creditcoin3-testnet.subscan.io/address/${address}`,
      'cc3-testnet': `https://creditcoin3-testnet.subscan.io/address/${address}`,
    }
    return explorers[chain.toLowerCase()] || `https://etherscan.io/address/${address}`
  }

  const getTxExplorerUrl = (chain: string, txHash: string) => {
    const explorers: Record<string, string> = {
      ethereum: `https://etherscan.io/tx/${txHash}`,
      sepolia: `https://sepolia.etherscan.io/tx/${txHash}`,
      'cc3 testnet': `https://creditcoin3-testnet.subscan.io/tx/${txHash}`,
      'cc3-testnet': `https://creditcoin3-testnet.subscan.io/tx/${txHash}`,
    }
    return explorers[chain.toLowerCase()] || `https://etherscan.io/tx/${txHash}`
  }

  // Load chains and leaderboard once on mount
  useEffect(() => {
    const loadGlobalData = async () => {
      setLoading(prev => ({ ...prev, chains: true, leaderboard: true }))
      try {
        const [chainsRes, leaderboardRes] = await Promise.all([
          chainsStatus().catch(e => { throw e }),
          leaderboard().catch(e => { throw e }),
        ])
        setChainsData(chainsRes.chains)
        setLeaderboardData(leaderboardRes.leaderboard)
        setErrors(prev => ({ ...prev, chains: null, leaderboard: null }))
      } catch (e: any) {
        const errorMsg = e instanceof ApiError ? e.message : 'Failed to connect to API'
        setErrors(prev => ({ ...prev, chains: errorMsg, leaderboard: errorMsg }))
      } finally {
        setLoading(prev => ({ ...prev, weights: false, chains: false, leaderboard: false }))
      }
      setLoading(prev => ({ ...prev, chains: false, leaderboard: false }))
    }
    loadGlobalData()
  }, [])

  const loadWalletData = async (address: string) => {
    setLoading(prev => ({ ...prev, summary: true, events: true }))
    setErrors(prev => ({ ...prev, summary: null, events: null }))

    try {
      const [summaryRes, eventsRes] = await Promise.all([
        walletSummary(address),
        walletEvents(address, { page: 1, limit: eventPageSize }),
      ])
      setSummary(summaryRes)
      setEvents(eventsRes.events)
      setTotalEvents(eventsRes.pagination.total)
      setEventPage(1)
    } catch (e: any) {
      setErrors(prev => ({
        ...prev,
        summary: e instanceof ApiError ? e.message : 'Failed to load wallet data',
        events: e instanceof ApiError ? e.message : 'Failed to load events',
      }))
    } finally {
      setLoading(prev => ({ ...prev, summary: false, events: false }))
    }
  }

  // Load wallet data when address changes
  useEffect(() => {
    const addressToLoad = searchAddress || walletAddress
    if (!addressToLoad || addressToLoad === currentAddress) return

    setCurrentAddress(addressToLoad)
    loadWalletData(addressToLoad)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchAddress, walletAddress])

  // Auto-register wallet when connected
  useEffect(() => {
    if (!walletAddress) return

    const autoRegister = async () => {
      try {
        await registerWallet(walletAddress)
      } catch (e) {
        // Silently fail - registration is optional
        console.debug('Auto-registration failed:', e)
      }
    }

    autoRegister()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress])

  const loadLeaderboard = async () => {
    setLoading(prev => ({ ...prev, leaderboard: true }))
    setErrors(prev => ({ ...prev, leaderboard: null }))

    try {
      const res = await leaderboard()
      setLeaderboardData(res.leaderboard)
    } catch (e: any) {
      setErrors(prev => ({ ...prev, leaderboard: e instanceof ApiError ? e.message : 'Failed to load leaderboard' }))
    } finally {
      setLoading(prev => ({ ...prev, leaderboard: false }))
    }
  }

  // Reset page when page size changes
  useEffect(() => {
    setEventPage(1)
  }, [eventPageSize])

  // Load filtered events whenever page/filters/address/pageSize change
  useEffect(() => {
    if (!currentAddress) return

    const loadFilteredEvents = async () => {
      setLoading(prev => ({ ...prev, events: true }))
      setErrors(prev => ({ ...prev, events: null }))

      try {
        const params: any = { page: eventPage, limit: eventPageSize }
        if (eventFilter) params.eventName = eventFilter
        if (protocolFilter) params.protocol = protocolFilter

        const res = await walletEvents(currentAddress, params)
        setEvents(res.events)
        setTotalEvents(res.pagination.total)
      } catch (e: any) {
        setErrors(prev => ({ ...prev, events: e instanceof ApiError ? e.message : 'Failed to load events' }))
      } finally {
        setLoading(prev => ({ ...prev, events: false }))
      }
    }

    loadFilteredEvents()
  }, [eventPage, eventPageSize, eventFilter, protocolFilter, currentAddress])

  const handleSearch = () => {
    if (query.trim()) {
      setSearchAddress(query.trim())
    }
  }

  const handleRefresh = () => {
    if (currentAddress) {
      loadWalletData(currentAddress)
    }
  }

  const rankInfo = useMemo(() => {
    if (!currentAddress || !leaderboardData.length) return null
    const entry = leaderboardData.find(e => e.wallet.toLowerCase() === currentAddress.toLowerCase())
    if (!entry) return null
    const percentile = Math.round((1 - entry.rank / leaderboardData.length) * 100)
    return { rank: entry.rank, percentile }
  }, [currentAddress, leaderboardData])

  const maxScore = useMemo(() => {
    if (leaderboardData.length > 0) {
      return Math.max(...leaderboardData.map(e => e.score))
    }
    return 1000
  }, [leaderboardData])

  const value: AppDataContextValue = {
    walletAddress,
    isConnected,
    isConnecting,
    walletError,
    connect,
    disconnect,

    query,
    setQuery,
    handleSearch,
    currentAddress,

    summary,
    events,
    leaderboardData,
    chainsData,

    loading,
    errors,

    eventPage,
    setEventPage,
    eventPageSize,
    setEventPageSize,
    eventFilter,
    setEventFilter,
    protocolFilter,
    setProtocolFilter,
    totalEvents,

    selectedChain,
    setSelectedChain,

    loadWalletData,
    loadLeaderboard,
    handleRefresh,
    getBlockExplorerUrl,
    getTxExplorerUrl,

    rankInfo,
    maxScore,
    eventIcons,
    eventColors,
    protocolColors,
  }

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData() {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider')
  return ctx
}