# Architecture Decision Records (civic-ai-tools-website)

This directory is a stub. ADRs governing the **evidence system** live in the canonical hub-repo location: [`civic-ai-tools/docs/adr/`](https://github.com/npstorey/civic-ai-tools/tree/main/docs/adr).

## Current ADRs (canonical location)

| # | Title | Status |
|---|-------|--------|
| 0001 | Public-roadmap governance | Accepted |
| 0002 | Trust commitments vs. operational targets | Accepted |
| 0003 | Capture-method differentiation for evidence packages | Accepted |

## Policy

ADRs in this repo cover decisions that govern **web-specific concerns** — Vercel deployment configuration, Next.js routing/rendering choices, browser-only code, the marketing site, third-party site integrations. Decisions that govern the broader evidence system (package format, signing, publishing protocol, identity model, capture-method vocabulary, attestation types) live in the canonical hub-repo location regardless of which repo holds the implementation.

When in doubt, prefer the hub-repo location and cross-link from here when a hub-repo ADR has substantial site-side consequences.

This README is itself a stub and should be replaced with real ADRs as web-specific decisions accumulate.
