const { ethers } = require('ethers');

// Test keccak256 of different signatures
const signatures = [
  'depositETH(address,uint16,address)',
  'depositETH(address,address,uint16)',
  'depositETH(address,address,uint16,address)',
  'depositETH(address,uint256,uint16,address)',
  'depositETH(address,uint256,address,uint16)',
  'depositETH(address,uint256,uint16)',
  'depositETH(address,uint256,address)',
  'depositETH(address,uint256)',
  'depositETH(address,uint16)',
  'depositETH(address)',
  'depositETH(address,uint256,uint256)',
  'depositETH(address,uint256,uint256,uint16)',
  'depositETH(address,uint256,uint256,uint16,address)',
  'depositETH(address,uint256,uint256,address,uint16)',
  'depositETH(uint256,address,uint16)',
  'depositETH(uint256,uint16,address)',
  'depositETH(uint256,address)',
  'depositETH(uint256,uint16)',
  'depositETH(uint256)',
];

console.log('Testing keccak256 of potential signatures:');
for (const sig of signatures) {
  const hash = ethers.keccak256(ethers.toUtf8Bytes(sig));
  const selector = hash.substring(0, 10);
  if (selector === '0xf26493a3') {
    console.log(`✓ MATCH: ${sig} -> ${selector}`);
  } else {
    console.log(`  ${sig} -> ${selector}`);
  }
}