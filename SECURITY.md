# Security Policy

ENZO is a BYOK workspace. Provider keys and your data flow browser → ENZO → the provider you picked, and you pay that provider their normal price. Nothing sits in between taking a cut. Most of what "security" means here is keeping exactly that property true.

## Supported versions

Only the latest tagged release gets fixes.

| Version | Supported |
|---|---|
| Latest release (`ghcr.io/theguysudo/enzo:latest`) | ✅ |
| Older tags | ❌ — upgrade |

## How your keys are handled

- In hosted/BYOK mode, visitor keys are **never persisted server-side**. They live as AES-256-GCM ciphertext in the browser vault (`src/lib/keyVault.ts`) and are sent per request, straight through to the provider.
- In self-hosted mode, the operator's keys live in `.env` (never committed; `.env.example` is placeholder-only) or in the vault UI.
- CI scans every tracked file for real key shapes, blocks provider-key access through raw `localStorage` outside `keyVault.ts`, and fails the build if `.env` is ever tracked.
- There is no ENZO account, no usage meter, no subscription — nothing that would make your keys interesting to anyone running this.

## Reporting a vulnerability

Report privately through [GitHub Security Advisories](https://github.com/theguysudo/ENZO/security/advisories/new). Please don't open a public issue — a repro without any key in it can still be enough to hurt a deployed instance.

Helpful things to include:

- What you found, and how you found it.
- Which deploy mode it affects (hosted/BYOK, self-hosted, docker image) and the version or commit.
- Whether a deployed instance would need any special configuration to be exposed.

**Never paste real API keys anywhere** — in reports, issues, or terminal logs. Mask them (`sk-***`).

## What happens next

Reports get read as fast as a solo maintainer can manage. Accepted fixes land in the next release; if you'd like credit, it goes in the changelog.
