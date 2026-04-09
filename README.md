# Qryptum Contracts

Solidity contracts for the Qryptum protocol. Non-custodial ERC-20 shielding on Ethereum L1 using keccak256 vault proof security.

## Contracts

- **ShieldFactory** - Deploys personal Qrypt-Safes using minimal proxy clones
- **PersonalVault** - The Qrypt-Safe: shields ERC-20 tokens behind a vault proof
- **ShieldToken** - Non-transferable qToken representing shielded balance
- **MockERC20** - Test token for local development

## Deployments

### Sepolia Testnet (Active v2)

| Contract | Address |
|---|---|
| ShieldFactory v2 | `0x0c060e880A405B1231Ce1263c6a52a272cC1cE05` |
| PersonalVault impl | `0x5A77630B5D49943f71785BC57aF37380bBea0c5e` |
| qUSDC (6 decimals) | `0xcD1569A66F01023a8587D69F3D3ad9C4DA12c3Cf` |

## Tests

84/84 tests passing. 8 live Sepolia scenarios via `scripts/e2e-test.js`.

```bash
npm install
npx hardhat test
```

## License

MIT
