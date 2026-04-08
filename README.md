# Qryptum Contracts

[![License: MIT](https://img.shields.io/badge/License-MIT-white.svg)](LICENSE)

Smart contracts powering the Qryptum protocol on Ethereum.

## Contracts

### ShieldFactory

EIP-1167 clone factory. Deploys one PersonalVault per wallet address.

- `createVault(bytes32 passwordHash)` deploys a vault clone and emits `VaultCreated`
- `hasVault(address)` and `getVault(address)` for lookup
- Inherits `Ownable` and `Pausable` for emergency pause by deployer

### PersonalVault (QRYPTANK)

Core vault contract. Each user owns exactly one instance, for life.

- `shield(tokenAddress, amount, vaultProof)` pulls ERC-20 and mints qToken
- `unshield(tokenAddress, amount, vaultProof)` burns qToken and returns ERC-20
- `commitTransfer(commitHash)` step 1 of commit-reveal transfer
- `revealTransfer(token, to, amount, vaultProof, nonce)` step 2, sends raw ERC-20 to recipient
- `changeVaultProof(old, new)` to rotate vault proof
- `emergencyWithdraw(tokens[])` available after approximately 6 months of inactivity

### ShieldToken (qToken)

Non-transferable ERC-20 representing shielded balance.

- `transfer()`, `transferFrom()`, and `approve()` always revert
- Mint and burn only callable by the owner vault
- Name auto-prefixed with `q` (e.g. qUSDT, qETH)

## Security Model

- Users retain full self-custody. Real tokens are held in their own vault contract, not a shared pool.
- Qryptum deployer has zero access to any user vault.
- Vault proof verified on-chain via `keccak256`.
- Transfers require private key and vault proof simultaneously.

## Setup

```bash
cp .env.example .env
npm install
npm run compile
npm test
```

## Deployment

```bash
# Local node
npm run deploy:local

# Sepolia testnet
npm run deploy:sepolia

# Mainnet
npm run deploy:mainnet
```

## Tests

83 test cases covering all contract logic.

```bash
npm test
```

## License

[![License: MIT](https://img.shields.io/badge/License-MIT-white.svg)](LICENSE)

Copyright (c) 2026 [wei-zuan](https://github.com/wei-zuan). See [LICENSE](LICENSE) for full terms.


## Deployed Addresses (Sepolia Testnet)

### v2 -- Active (qToken decimal precision fix)

> **Why redeployed:** ShieldToken v1 defaulted to 18 decimals regardless of the underlying token.
> USDC has 6 decimals, so 9.5 qUSDC displayed as 0.0000000000095 in Etherscan and wallets.
> v2 fixes this: `ShieldToken` reads `decimals()` from the underlying ERC-20 at qToken deploy time
> and stores it permanently. All qTokens now display the correct amount for any token.

| Contract | Address | Etherscan |
|---|---|---|
| ShieldFactory v2 | `0x0c060e880A405B1231Ce1263c6a52a272cC1cE05` | [View source](https://sepolia.etherscan.io/address/0x0c060e880A405B1231Ce1263c6a52a272cC1cE05#code) |
| PersonalVault impl v2 | `0x5A77630B5D49943f71785BC57aF37380bBea0c5e` | Deployed |

### v1 -- Superseded (decimal precision bug)

| Contract | Address | Etherscan |
|---|---|---|
| ShieldFactory v1 | `0x9a66500886344cbcce882137f263CB0c61aa99b1` | [View source](https://sepolia.etherscan.io/address/0x9a66500886344cbcce882137f263CB0c61aa99b1#code) |
| PersonalVault impl v1 | `0x63f575b38e9C6a26eAeb57d2382bC42B456fafbf` | [View source](https://sepolia.etherscan.io/address/0x63f575b38e9C6a26eAeb57d2382bC42B456fafbf#code) |