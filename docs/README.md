# Documentation Framework

This directory contains the documentation framework for the Layer-2 on Solana project. The framework is organized according to best practices for technical documentation and includes the following components:

## Structure

```
docs/
├── README.md                     # Documentation overview
├── architecture/                 # Architecture documentation
│   ├── overview.md               # High-level architecture overview
│   ├── fraud-proof-system.md     # Fraud proof system design
│   ├── finalization-logic.md     # Block finalization logic
│   └── bridge-mechanism.md       # Bridge mechanism design
├── api-reference/               # API reference documentation
│   ├── l2-node-api.md           # L2 node API reference
│   ├── smart-contracts.md       # Smart contract API reference
│   └── sdk-reference.md         # SDK reference
├── guides/                      # Developer guides and tutorials
│   ├── getting-started.md       # Getting started guide
│   ├── bridge-usage.md          # Bridge usage tutorial
│   ├── challenge-simulation.md  # Challenge simulation guide
│   └── running-a-node.md        # Node setup guide
└── assets/                      # Documentation assets
    └── images/                  # Images for documentation
```

## Documentation Standards

All documentation in this project follows these standards:

1. **Clarity**: Documentation is written in clear, concise language that is accessible to developers of various experience levels.
2. **Completeness**: Documentation covers all aspects of the system, from high-level architecture to detailed API references.
3. **Examples**: All API references include examples of usage.
4. **Diagrams**: Architecture documentation includes diagrams to illustrate complex concepts.
5. **Versioning**: Documentation is versioned to match the software releases.

## Documentation Generation

API reference documentation is generated from source code comments using the following tools:

- For Rust code: `cargo doc`
- For Solidity contracts: NatSpec comments and documentation generators

## Contributing to Documentation

When contributing to the documentation:

1. Follow the established structure and standards.
2. Include examples for all new features or APIs.
3. Update diagrams when architecture changes.
4. Ensure all code samples are tested and working.
5. Use Markdown for all documentation files.

## Building the Documentation

To build the documentation site locally:

```bash
cd docs
npm install
npm run build
```

This will generate a static site in the `_site` directory that can be served locally or deployed to a documentation hosting service.
