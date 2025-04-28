# Layer-2 Complete for Solana

## Overview

Layer-2 Complete is a high-performance Layer-2 scaling solution for Solana that enables Ethereum token bridging and supports at least 10000 TPS (transactions per second). The system provides a secure and efficient bridge between Ethereum and Solana blockchains, allowing users to transfer ETH and other tokens between the two ecosystems.

## Key Features

- **High Performance**: Processes over 10000 TPS through optimized transaction batching and parallel processing
- **ETH Token Bridge**: Seamlessly transfer ETH tokens between Ethereum and Solana
- **Cross-Chain Communication**: Secure message passing between Ethereum and Solana using Wormhole protocol
- **EVM Compatibility**: Run Ethereum smart contracts on Solana
- **Advanced Security**: HSM integration, anomaly detection, and comprehensive security measures
- **Scalable Architecture**: Multi-threaded design with PostgreSQL for persistence

## Architecture

The system consists of several key components:

1. **Core Layer-2 System**: Manages the Layer-2 state, transaction processing, and block production
2. **Sequencer**: Batches transactions into bundles for efficient processing
3. **Bridge**: Enables cross-chain token transfers between Ethereum and Solana
4. **ETH Token Support**: Manages ETH tokens on Solana with automatic mapping
5. **Block Finalization**: Anchors Layer-2 blocks to Ethereum for security and verification
6. **Monitoring & Security**: Ensures system integrity and performance

## Getting Started

### Prerequisites

- Node.js v16 or higher
- PostgreSQL 14 or higher
- Solana CLI tools
- Ethereum development environment (optional for full bridge functionality)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/buybotsolana/SolCraft.git
cd SolCraft-OFFCHAIN-OPTIMIZED
```

2. Install dependencies:
```bash
npm install
```

3. Configure the environment:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Run the setup script:
```bash
./scripts/deploy_alpha.sh
```

### Usage

#### Running the Layer-2 Node

```bash
npm run start:prod
```

#### Interacting with the API

The API is available at `http://localhost:3000/api/v1` by default.

Example API endpoints:
- `GET /api/v1/health` - Check system health
- `GET /api/v1/stats` - Get system statistics
- `POST /api/v1/transactions` - Submit a transaction
- `GET /api/v1/transactions/:id` - Get transaction status
- `POST /api/v1/bridge/deposit` - Deposit ETH from Ethereum to Solana
- `POST /api/v1/bridge/withdraw` - Withdraw ETH from Solana to Ethereum

## Bridge Functionality

The bridge functionality allows users to transfer ETH tokens between Ethereum and Solana:

### Ethereum to Solana

1. User locks ETH tokens in the Ethereum bridge contract
2. Wormhole protocol verifies the transaction and creates a VAA (Verifiable Action Approval)
3. The Layer-2 system verifies the VAA and mints equivalent tokens on Solana
4. User receives ETH tokens on Solana

### Solana to Ethereum

1. User burns ETH tokens on Solana
2. Wormhole protocol verifies the transaction and creates a VAA
3. The VAA is submitted to the Ethereum bridge contract
4. User receives ETH tokens on Ethereum

## Performance

The system is designed to handle at least 10000 TPS through:

- Multi-threaded transaction processing
- Efficient batching of transactions
- Optimized database operations
- Parallel signature verification
- Gas optimization for Ethereum interactions

## Security

Security measures include:

- HSM integration for key management
- Rate limiting and firewall functionality
- Anomaly detection for suspicious activities
- Key rotation mechanisms
- Comprehensive audit logging

## Development

### Project Structure

```
├── src/
│   ├── api/            # API controllers and routes
│   ├── bridge/         # Bridge functionality
│   │   ├── ethereum/   # Ethereum connectors
│   │   ├── services/   # Bridge services
│   │   ├── solana/     # Solana connectors
│   │   └── wormhole/   # Wormhole integration
│   ├── config/         # Configuration management
│   ├── core/           # Core Layer-2 system
│   ├── database/       # Database services
│   ├── evm/            # EVM compatibility
│   ├── models/         # Data models
│   ├── monitoring/     # Monitoring services
│   ├── security/       # Security services
│   ├── sequencer/      # Sequencer services
│   ├── transaction/    # Transaction services
│   └── utils/          # Utility functions
├── tests/              # Test suite
│   ├── unit/           # Unit tests
│   ├── integration/    # Integration tests
│   └── e2e/            # End-to-end tests
├── scripts/            # Utility scripts
└── docs/               # Documentation
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suite
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:performance
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgements

- Solana Foundation
- Ethereum Foundation
- Wormhole Team
