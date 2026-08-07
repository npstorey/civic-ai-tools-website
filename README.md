# Civic AI Tools Website

The reference implementation of an evidence-publishing platform for AI-assisted
analysis of civic open data. Ask a plain-language question about public data;
the app answers it against live sources through
[Model Context Protocol (MCP)](https://modelcontextprotocol.io) servers, can
re-run the analysis as an executed notebook, and packages the result as a
**signed evidence package** anyone can verify independently.

Side-by-side comparison of a model answering with and without live data access
is one of the surfaces this app offers — the thing it publishes is the evidence.

> **Integrating?** Start at [`docs/api/evidence-publish.md`](docs/api/evidence-publish.md) — the evidence-publish contract, including the "Repositories & layers" orientation and the integration-contract section.

> **Running your own instance?** [`docs/deploy.md`](docs/deploy.md) is the guide, from `git clone` to a configured instance.

**Reference deployment:** [civicaitools.org](https://civicaitools.org)

## What's in it

| Surface | What it does |
| --- | --- |
| Home | Ask a question; see the answer with and without live data access, side by side. |
| Explore | The same query as an animated BPMN process diagram — live, or replayed from recorded traces. |
| Directory | A browsable inventory of MCP servers for civic data and the open-data portals they cover. |
| Evidence | The published registry, and a detail page per analysis carrying its signature, timestamp, and provenance. |
| Learn / About / Project / Roadmap | Educational and project prose. |
| Dashboard | A signed-in publisher's own evidence records and API tokens. |

An analysis becomes evidence in two states: **`sealed`** — signed, timestamped,
transparency-logged, unlisted — and **`public`**, which adds the publication
attestation and served content. An instance with no signing key configured runs
in the **unsigned tier**: analyses run and packages can be produced and
inspected, but neither state is reachable and the app says so on every page.
That is the intended first-run state, not a failure; signing is a deliberate
later step ([`docs/instance-setup.md`](docs/instance-setup.md)).

Built with Next.js (App Router) and React in TypeScript, with Postgres via
Drizzle, Ed25519 signing backed by an RFC 3161 timestamp and a public
transparency log, and three swappable driver seams — database, blob storage, and notebook executor —
so the same code runs on a managed platform or on your own hardware
([`docs/deploy.md`](docs/deploy.md#the-three-driver-decisions)).

## Quick start (local development)

Node.js ≥ 22 (`.nvmrc` pins 22).

```bash
git clone https://github.com/npstorey/civic-ai-tools-website.git
cd civic-ai-tools-website
npm install
npm run dev
```

Open <http://localhost:3000>. A checkout with **nothing configured** starts and
serves every page — initialization is lazy throughout — so the first run works
before any setup. What it cannot do yet is answer questions — queries fail
immediately with an error naming the variable to set.

Configuration goes in `.env.local`, which the dev server loads automatically
(never commit it). The minimum for working queries is one variable:

```bash
OPENROUTER_API_KEY=<your model API key>
```

Any OpenAI-compatible chat-completions endpoint works via `MODEL_API_BASE_URL`;
the key stays in `OPENROUTER_API_KEY` either way. Publishing evidence
additionally needs a database, object storage, sign-in, and a signing key —
don't guess that set. The executable authority is the preflight, which checks
the **presence** (never the value) of every variable the app reads and tiers
each one against your instance's drivers:

```bash
node scripts/preflight-env.mjs
```

A fresh checkout **fails** the preflight by design: the FAIL list is the
remaining go-to-production to-do list, not a broken install. The tier-by-tier
reference is
[`docs/deploy.md`](docs/deploy.md#environment-reference-tier-by-tier).

Other useful scripts: `npm test` (unit tests), `npm run lint`, `npm run build`.

## Self-hosting

The repository ships a [`docker-compose.yml`](docker-compose.yml) that wires the
whole self-hosted profile — app, Postgres, S3-compatible object storage with
bucket init, a one-shot migration runner, and a scheduler sidecar:

```bash
docker compose --profile build-only build executor-image   # once
docker compose up --build
```

That brings up an unsigned-tier instance, with no key material at all, on
`http://localhost:3000` — loopback-bound deliberately. Read [`docs/deploy.md`](docs/deploy.md) before going further:
it covers the driver decisions, the environment tier by tier, sign-in with your
own OAuth application, migrations, object storage, the scheduler, and a
**security note about the executor's socket mount** that anyone exposing this
stack to a network needs to have read.

## Integrating

External clients — CLIs, CI jobs, publish skills — talk to the same publish
endpoint the website's own UI uses. The contract, the OAuth 2.0 device flow for
bearer tokens, the request schema, and a worked example are in
[`docs/api/evidence-publish.md`](docs/api/evidence-publish.md); the read-only
proof sidecar that lets a third party verify a package without trusting this
host is in
[`docs/api/evidence-commitment.md`](docs/api/evidence-commitment.md).

## Documentation

| Document | What it covers |
| --- | --- |
| [`docs/deploy.md`](docs/deploy.md) | Self-hosted deployment end to end: bring-up, driver seams, environment reference, sign-in, migrations, storage, scheduler, managed-platform notes. |
| [`docs/instance-setup.md`](docs/instance-setup.md) | Instance identity and signing — keygen, trust registry, identity variables. The go-to-production step. |
| [`docs/key-rotation.md`](docs/key-rotation.md) | Signing-key rotation runbook, preventive and incident-response. |
| [`docs/api/evidence-publish.md`](docs/api/evidence-publish.md) | The publish API contract and integrator entry point. |
| [`docs/api/evidence-commitment.md`](docs/api/evidence-commitment.md) | The public proof sidecar served for each published package. |
| [`docs/design-principles.md`](docs/design-principles.md) | UX and data-model principles for AI-output and provenance surfaces. |
| [`civic-ai-tools/docs/architecture/`](https://github.com/npstorey/civic-ai-tools/tree/main/docs/architecture) | Canonical architecture in the hub repo: ADRs, spec drafts, and the open-questions registry. |

## Related

- [civic-ai-tools](https://github.com/npstorey/civic-ai-tools) — the hub repo: architecture decisions, spec drafts, MCP server configs, and the local starter project
- [socrata-mcp-server](https://github.com/npstorey/socrata-mcp-server) — the MCP server for Socrata open data portals
- [typedstandards](https://github.com/npstorey/typedstandards) — the standard's home: `@typedstandards/verify-core` and [typedstandards.org](https://typedstandards.org)
- [Model Context Protocol](https://modelcontextprotocol.io) — official MCP documentation

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the
[code of conduct](CODE_OF_CONDUCT.md).

## Disclaimer

This is a personal project and is not affiliated with, endorsed by, or
representative of any employer.

## License

MIT — see [LICENSE](LICENSE).
