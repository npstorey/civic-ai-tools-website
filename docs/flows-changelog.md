# Flows statement change log

The flows statement says where a question asked on this site can go: every
recipient by role and host, what each receives, and what each holder says it
keeps. Each instance serves its own at `/api/flows`, derived from its
configuration when asked (see the deployment guide's
[Consent and the flows statement](deploy.md#consent-and-the-flows-statement)).
A reader's consent refers to the statement it was given against (the gate is
on since #632 W3, with the consent card), so this log records, with dates,
each change to what the statement can say (design §4.7 item 12).

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
configuration and fails when they differ from the code. An entry also gives
the statement's **hash** (the SHA-256 of the bytes `/api/flows` serves) under
that configuration when the entry moves the hash but no version: such a
change re-asks no one.

## 2026-10-20 — the consent surfaces (#632 W3)

The wording changes; no version moves, so no reader is asked again by this
change alone (the anonymous cookie and the signed-in row given against the
2026-10-19 entry are still in force).

- The omitted-guide line is now "This site does not name a deployment guide."
  When `SITE_DEPLOYMENT_GUIDE_URL` is set, `links.deploymentGuide` carries the
  guide's address instead.
- The hosted source's sandbox line is two: this site's own setting (the
  sandbox is created persistent, keeps its last snapshot, and sets each
  snapshot to expire 30 days after its last use; `lifecycle.ts`), and
  Vercel's own statement, "Snapshots expire 30 days after their last use by
  default." (its sandbox snapshots page, read 2026-10-20). The sandbox
  platform's statement address is that page, read 2026-10-20, so the
  statement's `date` is 2026-10-20 under a configuration with a hosted source.
- When the operator sets `SITE_OPERATOR_STATES_NO_TRAINING`, the model
  endpoint's line carries the operator's statement (`operatorStatement`): the
  endpoint is set to send questions only to providers that do not train on
  them. It is the operator's statement, not a posture, and moves no version.

**Configuration:** the 2026-10-19 entry's, unchanged, with
`SITE_DEPLOYMENT_GUIDE_URL` and `SITE_OPERATOR_STATES_NO_TRAINING` unset.

**Base `version`:** `2489d0dda25a79b3286c380379c6d2c8202e66a77fe5b4f493f558a7ce190f9c` (unchanged)

**Source versions:** unchanged: `socrata` `fe99ec852eb7bfa3c95ce0db20cf5d2c7411b79b1e61c5ddbad3c19190a61629`,
`data-commons` `a0d757284510792921c7889ed537e75ebbc9890a1f96c71b0fe393bc46ceb334`,
`nyc-charter` `e381ddafc6d461ef1fdb913270aaac637d51801909613f6d7dc495fbcf6c7e61`.

**`date`:** 2026-10-20.

**Hash:** `7edd882ed18028dfc1dbd6a94bc103523f268e280846b1e72f4bb8fb65019a4d`

## 2026-10-19 — first publication

The statement is first published (#632 W2).

**Configuration:** the reference instance's configuration as its privacy page
stated it on 2026-10-19: the model service at `openrouter.ai`, Plausible
analytics loaded from `plausible.io`, notebooks in a Vercel Sandbox, GitHub
sign-in, Socrata at `socrata-mcp.civicaitools.org`, Data Commons at Google's
endpoint, and NYC Charter hosted. As variables:
`SOCRATA_MCP_URL=https://socrata-mcp.civicaitools.org`,
`NYC_CHARTER_HOSTING=sandbox`, `VERCEL_ENV` set (the site runs on Vercel),
`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` set,
`EXECUTOR_DRIVER=vercel-sandbox`, `NEXT_PUBLIC_ANALYTICS_SERVICE=plausible` and
`NEXT_PUBLIC_ANALYTICS_ID` set; `MODEL_API_BASE_URL` unset or at
`openrouter.ai`, and `DATA_COMMONS_MCP_URL` unset or at Google's endpoint.
Where a variable is only "set", the statement reads its presence and not its
value (the sign-in pair, the analytics id, `VERCEL_ENV`), so the versions
below hold for any value of it.

**Base `version`:** `2489d0dda25a79b3286c380379c6d2c8202e66a77fe5b4f493f558a7ce190f9c`

| Recipient | Where | What the holder says it keeps |
|---|---|---|
| The model endpoint | `openrouter.ai` | as the operator states (correction g) |
| The hosting platform's function logs | Vercel | metadata: this site's reading of Vercel's runtime logs page (kept 1 hour to 30 days, by the operator's plan) and of this site's tested guarantee that its logs carry no question, query or answer |
| Sign-in | `github.com` | metadata, as long as the account is active (GitHub's privacy statement, read 2026-10-19) |
| Analytics | `plausible.io` | metadata (Plausible's data policy, read 2026-10-18) |
| The notebook executor | Vercel Sandbox | not stated (Vercel's Sandbox pages, read 2026-10-19) |

| Source | Its `version` | Where it runs | What its holders say they keep |
|---|---|---|---|
| `socrata` | `fe99ec852eb7bfa3c95ce0db20cf5d2c7411b79b1e61c5ddbad3c19190a61629` | `socrata-mcp.civicaitools.org` | the server's operator: as the operator states; the portal platform (Tyler Technologies): not stated (read 2026-10-19) |
| `data-commons` | `a0d757284510792921c7889ed537e75ebbc9890a1f96c71b0fe393bc46ceb334` | Google's hosted endpoint, the default address | Google: content (read 2026-10-18) |
| `nyc-charter` | `e381ddafc6d461ef1fdb913270aaac637d51801909613f6d7dc495fbcf6c7e61` | this site's sandbox | the sandbox platform (Vercel): not stated (read 2026-10-19) |

Boston OpenContext is not configured in this shape. When it is, it adds a row
whose version depends on its address and moves no base version.
