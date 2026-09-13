const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://creditscore-rzua.onrender.com';

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new ApiError(`API endpoint not found. Make sure the backend server is running on ${API_URL}. Start it with: ./start-api.sh`, response.status);
      }
      const error = await response.text().catch(() => 'Unknown error');
      throw new ApiError(error || `HTTP ${response.status}`, response.status);
    }

    return response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof TypeError) {
      const isLocal = API_URL.includes('localhost') || API_URL.includes('127.0.0.1');
      const hint = isLocal
        ? 'Start the backend with: cd api && pnpm run dev'
        : 'The API server may be down or unreachable. Check the API status link below.';
      throw new ApiError(`Cannot connect to API server at ${API_URL}. ${hint}`, 0);
    }
    throw new ApiError(error instanceof Error ? error.message : 'Unknown error', 0);
  }
}

export interface HealthResponse {
  status: string;
  timestamp: string;
}

export interface WalletSummary {
  address: string;
  score: string;
  rawScore: number;
  netOutstandingUSD: number;
  stats: {
    supplyCount: string;
    borrowCount: string;
    repayCount: string;
    withdrawCount: string;
    liquidationCount: string;
  };
  unprovenCount: number;
  lastEventAt: string | null;
}

export interface IndexedEvent {
  id: number;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  eventName: string;
  wallet: string;
  asset: string | null;
  amount: string;
  chain: string;
  protocol?: string;
  timestamp: number | null;
  proven: boolean;
  createdAt: string;
}

export interface EventsResponse {
  events: IndexedEvent[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface LeaderboardEntry {
  rank: number;
  wallet: string;
  score: number;
}

export interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  totalWallets: number;
  limit: number;
}

export interface RegisterWalletResponse {
  wallet: string;
  points: number;
  registered: boolean;
}

export interface ChainStatus {
  chain: string;
  contractAddress: string;
  lastIndexedBlock: number;
  currentBlock: number | null;
  lag: number | null;
  lagBehind: number | null;
  updatedAt: string;
  error?: string;
}

export interface ChainsStatusResponse {
  chains: ChainStatus[];
  total: number;
}

export async function health(): Promise<HealthResponse> {
  return fetchAPI<HealthResponse>('/api/health');
}

export async function walletSummary(address: string): Promise<WalletSummary> {
  return fetchAPI<WalletSummary>(`/api/wallets/${address}/summary`);
}

export async function walletEvents(
  address: string,
  params?: { eventName?: string; proven?: boolean; page?: number; limit?: number }
): Promise<EventsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.eventName) searchParams.set('eventName', params.eventName);
  if (params?.proven !== undefined) searchParams.set('proven', params.proven.toString());
  if (params?.page) searchParams.set('page', params.page.toString());
  if (params?.limit) searchParams.set('limit', params.limit.toString());
  
  const query = searchParams.toString();
  return fetchAPI<EventsResponse>(`/api/wallets/${address}/events${query ? `?${query}` : ''}`);
}

export async function leaderboard(): Promise<LeaderboardResponse> {
  return fetchAPI<LeaderboardResponse>('/api/leaderboard');
}

export async function chainsStatus(): Promise<ChainsStatusResponse> {
  return fetchAPI<ChainsStatusResponse>('/api/chains/status');
}

export async function registerWallet(address: string): Promise<RegisterWalletResponse> {
  return fetchAPI<RegisterWalletResponse>(`/api/wallets/${address}/register`, {
    method: 'POST',
  });
}

// ── Transaction server ────────────────────────────────────────────────────────

const TX_SERVER_URL = process.env.NEXT_PUBLIC_TX_SERVER_URL || 'http://localhost:3002';

export interface TxResult {
  ok: boolean;
  txHash?: string;
  blockNumber?: number;
  operation?: string;
  asset?: string;
  amount?: string;
  creditEvent?: string;
  troveId?: string;
  error?: string;
}

/**
 * Execute a DeFi transaction via the local tx-server.
 *
 * @param protocol   "aave" | "compound" | "liquity"
 * @param operation  e.g. "supply", "borrow", "open", "add-coll" …
 * @param params     Optional body params (amount, troveId, …)
 */
export async function executeTx(
  protocol: string,
  operation: string,
  params: Record<string, string> = {}
): Promise<TxResult> {
  const url = `${TX_SERVER_URL}/${protocol}/${operation}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data: TxResult = await response.json();
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error — is the tx-server running?' };
  }
}
