# agents.md

Context for AI coding agents working on this repository.

## Project Purpose

`@btg-pencil-ai/browser-asset-caching` is a TypeScript library that caches browser assets (images, video, audio, etc.) using the Origin Private File System (OPFS) API. It provides a singleton `StorageManager` with LRU eviction, per-asset locking, and retry logic for resilient storage operations.

## Tech Stack

- **Language**: TypeScript (ES2020 target)
- **Package manager**: Yarn 4.4.0
- **Build**: Vite 6.x (library mode), TypeScript 5.7
- **Key dependencies**:
  - `opfs-tools` – OPFS file/dir operations
  - `comlink` – Worker communication (if used)
- **Dev dependencies**: Vitest, @types/node, idb

## Architecture and Directory Structure

```
browser-asset-caching/
├── lib/                    # Main library source
│   ├── index.ts            # Public API exports
│   ├── storage-manager.ts  # StorageManager singleton (OPFS, LRU, locking)
│   ├── types.ts            # AssetMetadata interface
│   ├── utils.ts            # getFileExtension, extractAssetId, file helpers
│   ├── constants.ts        # ROOT_PATH, MAX_STORAGE_SIZE, CHUNK_SIZE
│   ├── index.d.ts          # Type declarations
│   └── types.d.ts          # Vite client reference
├── examples/
│   ├── demo.html           # OPFS Cache Tester UI
│   └── demo.ts             # Demo app logic (init, add, clear, preview)
├── .github/workflows/      # CI: push.yaml (build), publish-npm-package.yaml
├── vite.config.ts         # Library build + Vitest config
├── vite.demo-config.ts    # Demo app dev server (port 3000)
├── tsconfig.json          # Dev/IDE config
└── tsconfig.build.json    # Declaration emit for dist/
```

## Coding Conventions and Patterns

- **Naming**: camelCase for functions/variables; PascalCase for classes/interfaces
- **Private fields**: Use `#` private class fields (e.g. `#rootDir`, `#assetLocks`)
- **Error handling**: `console.error` for failures; `console.warn` for retries; throw after max retries
- **Async**: All storage operations are async; use `#withLock` for per-asset serialization
- **Retries**: `#retryOperation` with exponential backoff (200ms base) for OPFS/fetch errors
- **Exports**: Public API via `lib/index.ts`; re-export types, utils, constants

## Build and Run

```bash
# Install
yarn

# Build library (ES + CJS + .d.ts)
yarn build

# Build demo
yarn build:demo

# Dev server for demo (port 3000)
yarn dev

# Watch build
yarn build:watch
```

## Testing

- **Framework**: Vitest (configured in `vite.config.ts`)
- **Script**: `yarn lint` runs `eslint . --ext .ts`
- No dedicated test files found; demo app serves as manual validation

## Style and Linting

- **Prettier**: `.prettierrc.cjs` – single quotes, trailing comma es5, printWidth 120, bracketSameLine
- **EditorConfig**: LF, insert final newline, 2-space indent for `*.{js,json,yml}`
- **ESLint**: `yarn lint` – TypeScript files
- **TypeScript**: strict mode, noUnusedLocals, noUnusedParameters, noFallthroughCasesInSwitch

## Important Files and Roles

| File | Role |
|------|------|
| `lib/storage-manager.ts` | Core singleton: OPFS storage, LRU eviction, locking, retries |
| `lib/index.ts` | Public API surface |
| `lib/constants.ts` | `ROOT_PATH`, `MAX_STORAGE_SIZE`, `CHUNK_SIZE` |
| `lib/utils.ts` | MIME→extension mapping, `extractAssetId`, file conversion helpers |
| `lib/types.ts` | `AssetMetadata` interface |
| `vite.config.ts` | Library build entry `lib/index.ts`, outputs ESM + CJS |
| `tsconfig.build.json` | Emits `.d.ts` to `dist/`, excludes tests |

## CI/CD

- **push.yaml**: On push, runs `yarn build`
- **publish-npm-package.yaml**: On `development`/`main`, publishes to Google Artifact Registry via `yarn release`

## Notes for AI Agents

- OPFS is browser-only; no Node.js runtime for core logic
- `StorageManager` is a singleton; constructor returns existing instance
- Asset IDs are derived from URL filename (e.g. `url.split('/').pop().split('.')[0]`)
- Cache metadata lives at `{assetDir}/cache-metadata.json`; user metadata at `{assetDir}/{assetId}-meta.json`
