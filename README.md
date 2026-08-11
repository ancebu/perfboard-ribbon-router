# tscircuit-perfboard-router

A constraint-driven 2D graph autorouter for tscircuit perfboards featuring mirrored ribbon traces, 45-degree diagonal bishop jumps, insulated jumper wire fallbacks, and protected manual pre-routes.

## Features

- **Mirrored Ribbon Model**: Claims grid points on both Top and Bottom layers simultaneously
- **Multiple Movement Types**: Orthogonal, diagonal (bishop), and jumper wire leaps
- **Manual Route Protection**: Pre-routed sections are locked and respected
- **Negotiation & Rip-Up**: Automatic conflict resolution for dense routing scenarios

## Installation

```bash
npm install
```

## Usage

Run the test router:

```bash
npm test
```

## Project Structure

```
├── lib/
│   ├── router/           # Core router implementation
│   │   ├── types.ts      # TypeScript interfaces
│   │   ├── PerfboardRouter.ts  # Main router engine
│   │   └── negotiator.ts # Rip-up and reroute logic
│   └── docs/             # Documentation
│       └── README.md     # Detailed technical specification
├── test-router.ts        # Test circuit implementation
├── package.json
└── tsconfig.json
```

## Example Circuit

The included test demonstrates a 5x7cm perfboard with:
- 3V3 power header pin
- Ground connection
- Two resistors controlled by MOSFETs
- Two push buttons for gate control

See `test-router.ts` for the complete implementation.

## Documentation

For detailed technical specifications including architecture, data structures, and integration guidelines, see [`lib/docs/README.md`](./lib/docs/README.md).

## License

ISC
