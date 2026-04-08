# Qryptum Contracts

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
# fill in your values
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

MIT
