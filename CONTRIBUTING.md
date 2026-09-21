# Contributing to ENZO

ENZO is a self-hosted, BYOK AI workspace: chat with 300+ models, build agents, research, generate code — on your keys, on your infrastructure. Thanks for wanting to improve it.

## Ground rules

**The BYOK promise is non-negotiable.** When you send a message, the request goes browser → ENZO → the provider you picked, and you pay that provider their normal price. Nothing sits in between taking a cut. Features that need an ENZO-side account, meter usage, proxy paid APIs for a cut, or store a visitor's API keys server-side are out of scope by design. If your idea touches this line, say so up front — it will get a fair hearing, but it starts from a no.

**Security invariants are CI-enforced.** The pipeline fails the build if you:

- commit a real API key literal in any tracked file,
- read or write provider keys through raw `localStorage` outside `src/lib/keyVault.ts` (it is the only file allowed, because it is what writes the AES-256-GCM ciphertext),
- track `.env`,
- weaken the onboarding gate — a placeholder key that satisfies it is a login bypass.

## Ways to contribute

- **Bug reports** — use the bug report template, include terminal output, and mask your keys.
- **Feature ideas** — open a discussion first if it's half-formed; use the feature template once it's solid.
- **Docs** — the README, usage guide, and changelog all take fixes. If a step didn't work for you, that's a bug in the docs.
- **Code** — see the setup below.

## Setting up a dev environment

Prerequisites: Node 20+ (CI pins Node 20) and npm. `better-sqlite3` compiles from source when no prebuilt binary matches your Node version, so you may need standard build tools installed.

```bash
git clone https://github.com/theguysudo/ENZO.git
cd ENZO
cp .env.example .env
npm install
```

The server **boots with zero provider keys** — that's the BYOK contract, and CI tests it. To use provider-backed features, either fill keys into `.env` (self-hosted, single operator) or store them in the vault UI after boot (hosted/BYOK mode, where keys are never persisted server-side).

Run it:

```bash
# backend (Express API) on :5001
npx tsx index.ts

# frontend (React/Vite) on :5173 — or start both with ./scripts/start-servers.sh
cd synthetic-nature && npm run dev
```

The frontend sends API calls to the backend on `:5001`; if you move the backend, set `VITE_BACKEND_ORIGIN` before starting the dev server.

## Project layout

| Path | What lives there |
|---|---|
| `index.ts` | The Express backend — API routes, provider proxying, the keyless BYOK boot logic |
| `src/agent/`, `src/models/`, `src/core/` | Agent loop and search, the 300+-model catalog sync, env management and the crypto store |
| `src/agents/` | Custom Agent Builder — describe a task, it drafts the agent's operating manual |
| `synthetic-nature/` | The React/Vite frontend (chat terminal, marketplace, music, voice) |
| `synthetic-nature/src/lib/keyVault.ts` | AES-256-GCM key storage — the only file allowed to touch `localStorage` for provider keys |
| `tests/` | Unit and security tests (`npm test`) |
| `scripts/` | Dev runners, CI helpers, release tooling |
| `docs/` | Changelog and assets |

## Before you open a PR

Run the same checks CI runs:

```bash
npm run typecheck        # tsc over the backend — tsx transpiles per-file and never sees bad imports
npm run check:imports    # every imported file must also be tracked by git
npm test                 # unit tests

cd synthetic-nature
npx tsc --noEmit         # strict type-check
npm run build            # production build
```

CI also runs `npm audit --audit-level=high` on both package trees and a black-box pentest (`scripts/pentest.sh`) against a live boot. If your change touches an API route, run the pentest locally too.

Commit style: conventional commits, matching the repo's history — `feat:`, `fix:`, `docs:`, `ci:`, `build:`. One focused change per PR beats a grab-bag; say what changed and why in the body.

**Don't change without discussing first:** the keyVault localStorage rule, the onboarding gate, the keyless-boot contract (the server must start with no provider keys), and the `scripts/pentest.sh` assertions.

## Reporting security issues

Please don't open a public issue for a security problem — even a repro with no key in it can be enough to hurt a deployed instance. Report it privately via [GitHub Security Advisories](https://github.com/theguysudo/ENZO/security/advisories/new) instead, with what you found, how you found it, and which deploy mode and version it affects.

And everywhere — issues, PRs, terminal logs — mask your keys. Paste `sk-***`, never the real thing.

## License

Apache-2.0. By contributing, you agree that your contributions will be licensed under the same terms.
