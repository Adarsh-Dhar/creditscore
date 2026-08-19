require('dotenv').config();
const { ethers } = require('ethers');

async function getGatewayABI() {
  const SEPOLIA_RPC = process.env.SEPOLIA_RPC;
  const WETH_GATEWAY = '0x387d311e47e80b498169e6fb51d3193167d89F7D';

  if (!SEPOLIA_RPC) {
    console.error('Missing SEPOLIA_RPC');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);

  // Get the contract's transaction from block 11519959
  const txHash = '0xc087a15f7fd794a17794224b264c5284e0f32f30f60d746a4504d2ea13e93480';
  const tx = await provider.getTransaction(txHash);

  console.log(`Transaction to: ${tx.to}`);
  console.log(`Transaction data: ${tx.data.substring(0, 10)}`);
  console.log(`Transaction data length: ${tx.data.length}`);

  // Try to decode the function signature
  const selector = tx.data.substring(0, 10);
  console.log(`\nSelector: ${selector}`);

  // Get the WETHGateway contract ABI
  const gateway = new ethers.Contract(
    WETH_GATEWAY,
    [],
    provider
  );

  // Try common WETHGateway functions
  const functions = [
    'depositETH(address,uint16,address)',
    'depositETH(address,uint256,uint16)',
    'depositETH(address,uint256)',
    'depositETH(address,uint256,address)',
    'depositETH(address,uint256,uint256)',
    'depositETH(address,uint256,uint256,uint16)',
    'depositETH(address,uint256,uint256,uint16,address)',
    'depositETH(address,uint256,uint256,address,uint16)',
    'depositETH(address,uint256,uint256,uint256)',
    'depositETH(address,uint256,uint256,uint256,uint16)',
    'depositETH(address,uint256,uint256,uint256,uint16,address)',
    'depositETH(address,uint256,uint256,uint256,address,uint16)',
    'depositETH(address,uint256,uint256,uint256,uint256)',
    'depositETH(address,uint256,uint256,uint256,uint256,uint16)',
    'depositETH(address,uint256,uint256,uint256,uint256,uint16,address)',
    'depositETH(address,uint256,uint256,uint256,uint256,address,uint16)',
    'depositETH(address,uint256,uint256,uint256,uint256,uint256)',
    'depositETH(address,uint256,uint256,uint256,uint256,uint256,uint16)',
    'depositETH(address,uint256,uint256,uint256,uint256,uint256,uint16,address)',
    'depositETH(address,uint256,uint256,uint256,uint256,uint256,address,uint16)',
    'depositETH(address,uint256,uint256,uint256,uint256,uint256,uint256)',
  ];

  console.log('\nTesting function signatures:');
  for (const func of functions) {
    const iface = new ethers.Interface([`function ${func}`]);
    const sel = iface.getFunction(func).selector;
    if (sel === selector) {
      console.log(`✓ MATCH: ${func} -> ${sel}`);
    }
  }
}

getGatewayABI().catch(console.error);