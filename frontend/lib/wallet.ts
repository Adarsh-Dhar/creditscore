import { useState, useEffect } from 'react';

declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean;
      request: (args: { method: string; params?: any[] }) => Promise<any>;
      on: (event: string, handler: (accounts: string[]) => void) => void;
      removeListener: (event: string, handler: (accounts: string[]) => void) => void;
    };
  }
}

export interface WalletState {
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    address: null,
    isConnected: false,
    isConnecting: false,
    error: null,
  });

  useEffect(() => {
    // Check if wallet is already connected on mount
    const checkConnection = async () => {
      if (window.ethereum) {
        try {
          // Skip the automatic check if extensions are interfering
          // Users can manually connect via the button
          const accounts = await Promise.race([
            window.ethereum.request({ method: 'eth_accounts' }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Connection check timeout')), 2000)
            )
          ]) as string[];
          
          if (accounts && accounts.length > 0) {
            setState({
              address: accounts[0],
              isConnected: true,
              isConnecting: false,
              error: null,
            });
          }
        } catch (error) {
          // Silently fail on initial check - don't bother user with extension errors
          // They can manually connect if needed
          console.log('Wallet check skipped (likely extension interference)');
        }
      }
    };

    checkConnection();

    // Listen for account changes
    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        setState({
          address: null,
          isConnected: false,
          isConnecting: false,
          error: null,
        });
      } else if (accounts[0] !== state.address) {
        setState({
          address: accounts[0],
          isConnected: true,
          isConnecting: false,
          error: null,
        });
      }
    };

    if (window.ethereum) {
      window.ethereum.on('accountsChanged', handleAccountsChanged);
    }

    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      }
    };
  }, [state.address]);

  const connect = async (retryCount = 0) => {
    if (!window.ethereum) {
      setState({
        address: null,
        isConnected: false,
        isConnecting: false,
        error: 'No wallet extension found. Please install MetaMask or another Web3 wallet.',
      });
      return;
    }

    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      // Try to request accounts with a longer timeout and retry mechanism
      const accounts = await Promise.race([
        window.ethereum.request({ method: 'eth_requestAccounts' }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 15000)
        )
      ]) as string[];
      
      if (accounts && accounts.length > 0) {
        setState({
          address: accounts[0],
          isConnected: true,
          isConnecting: false,
          error: null,
        });
      } else {
        setState({
          address: null,
          isConnected: false,
          isConnecting: false,
          error: 'No accounts found in wallet.',
        });
      }
    } catch (error: any) {
      console.error('Wallet connection error:', error);
      
      // Handle specific error cases
      if (error.code === 4001) {
        setState({
          address: null,
          isConnected: false,
          isConnecting: false,
          error: 'Connection request was rejected. Please try again.',
        });
      } else if (error.message === 'Connection timeout') {
        // Retry once on timeout
        if (retryCount < 1) {
          console.log('Retrying wallet connection...');
          setTimeout(() => connect(retryCount + 1), 1000);
          return;
        }
        
        setState({
          address: null,
          isConnected: false,
          isConnecting: false,
          error: 'Connection timed out after retry. Browser extension interference detected. Please try: 1) Use incognito mode, 2) Disable other extensions, or 3) Try a different browser.',
        });
      } else if (error.message?.includes('chrome-extension')) {
        setState({
          address: null,
          isConnected: false,
          isConnecting: false,
          error: 'Browser extension interference detected. The extension "bfnaelmomeimhlpmgjnjophhpkkoljpa" is conflicting with wallet connection. Try incognito mode or disable this extension.',
        });
      } else {
        setState({
          address: null,
          isConnected: false,
          isConnecting: false,
          error: error?.message || 'Failed to connect wallet. Try disabling conflicting browser extensions.',
        });
      }
    }
  };

  const disconnect = () => {
    setState({
      address: null,
      isConnected: false,
      isConnecting: false,
      error: null,
    });
  };

  return {
    ...state,
    connect,
    disconnect,
  };
}
