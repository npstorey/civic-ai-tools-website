# Flows statement change log

The flows statement says where a question asked on this site can go: every
recipient by role and host, what each receives, and what each holder says it
keeps. Each instance serves its own at `/api/flows`, derived from its
configuration when asked (see the deployment guide's
[Consent and the flows statement](deploy.md#consent-and-the-flows-statement)).
A reader's consent refers to the statement it was given against, so this log
records, with dates, each change to what the statement can say (design §4.7
item 12).

**How to read the versions.** Each entry gives the statement's base `version`
(a SHA-256 over the instance-level recipients and their postures) and each
source's own `version`, computed under the configuration the entry names.
Another configuration (another model endpoint, another sign-in provider,
analytics, another notebook runner, another source address) has other
versions: an instance's own are what its `/api/flows` serves. A version moves
when a recipient is added or removed, or a host, a hosting arrangement, what a
recipient receives or a posture changes; it does not move when a statement is
re-read and says the same, or when a source is configured (D5, D7). The
statement's `date` is the latest date on which one of the statements it
carries was read.

`src/lib/flows/changelog.test.ts` recomputes each entry's versions under its
configuration and fails when they differ from the code.

## 2026-10-19 — first publication

The statement is first published (#632 W2).

**Configuration** (the reference instance's shape; credential values are
placeholders, which no version reads): `SOCRATA_MCP_URL=https://socrata-mcp.civicaitools.org`,
`NYC_CHARTER_HOSTING=sandbox`, `VERCEL_ENV=production`, GitHub sign-in
(`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`), `EXECUTOR_DRIVER=vercel-sandbox`;
the model endpoint, Data Commons address and analytics unset (their defaults:
the model service at `openrouter.ai`, Google's Data Commons endpoint, no
analytics).

**Base `version`:** `c65c8692eb7199ab8fbee00169593e2d208b38ec4e9dd5964a613057570af877`

| Recipient | Where | What the holder says it keeps |
|---|---|---|
| The model endpoint | `openrouter.ai` | as the operator states (correction g) |
| The hosting platform's function logs | Vercel | metadata: this site's reading of Vercel's runtime logs page (kept 1 hour to 30 days, by the operator's plan) and of this site's tested guarantee that its logs carry no question, query or answer |
| Sign-in | `github.com` | metadata, as long as the account is active (GitHub's privacy statement, read 2026-10-19) |
| The notebook executor | Vercel Sandbox | not stated (Vercel's Sandbox pages, read 2026-10-19) |

| Source | Its `version` | Where it runs | What its holders say they keep |
|---|---|---|---|
| `socrata` | `fe99ec852eb7bfa3c95ce0db20cf5d2c7411b79b1e61c5ddbad3c19190a61629` | `socrata-mcp.civicaitools.org` | the server's operator: as the operator states; the portal platform (Tyler Technologies): not stated (read 2026-10-19) |
| `data-commons` | `a0d757284510792921c7889ed537e75ebbc9890a1f96c71b0fe393bc46ceb334` | Google's hosted endpoint, the default address | Google: content (read 2026-10-18) |
| `nyc-charter` | `e381ddafc6d461ef1fdb913270aaac637d51801909613f6d7dc495fbcf6c7e61` | this site's sandbox | the sandbox platform (Vercel): not stated (read 2026-10-19) |

Boston OpenContext is not configured in this shape. When it is, it adds a row
whose version depends on its address and moves no base version.
