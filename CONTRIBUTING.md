# Contributing to Civic AI Tools Website

Thank you for your interest in contributing! This is the demo website for the civic AI tools project, showing how MCP connects AI to live civic data.

## Ways to contribute

### No coding required

- **Report bugs** — If something looks off or doesn't work, [open an issue](https://github.com/npstorey/civic-ai-tools-website/issues/new)
- **Suggest features** — Ideas for improving the demo experience are welcome
- **Improve documentation** — Typos, unclear instructions, or missing steps are all fair game

### Code contributions

- **Fix bugs** — Check [open issues](https://github.com/npstorey/civic-ai-tools-website/issues) for things to work on
- **UI improvements** — Accessibility, responsive design, and UX enhancements
- **New visualizations** — Ideas for better ways to show MCP value

## Getting started

1. Fork the repo and clone your fork
2. Copy `.env.example` to `.env.local` and fill in the values — `node scripts/preflight-env.mjs` reports what your setup requires, and [`docs/deploy.md`](docs/deploy.md#environment-reference-tier-by-tier)'s "Environment reference, tier by tier" section explains what each variable does
3. Run `npm install && npm run dev`
4. Create a branch for your changes
5. Submit a pull request

## If you use Claude Code

Cloning this repo installs its checked-in Claude Code configuration: `.claude/settings.json` (a network allowlist, a sandbox block, and a `PreToolUse` hook at `.claude/hooks/drizzle-migrate-guard.sh` that pauses schema-applying `drizzle-kit` runs so you verify them with a read-back), plus the agent definitions in `.claude/agents/` and the path-scoped rules in `.claude/rules/`.

Those files are ordinary shell and JSON — read them before you trust them, the same as any other code you clone. Personal overrides belong in `.claude/settings.local.json`, which is gitignored.

## Guidelines

- Keep changes focused — one fix or feature per PR
- Test your changes before submitting
- Update documentation if your change affects setup or usage
- Be respectful in issues and pull requests

## This is a multi-repo project

This website is one part of a larger project. If you're unsure where to contribute, see the [civic-ai-tools CONTRIBUTING guide](https://github.com/npstorey/civic-ai-tools/blob/main/CONTRIBUTING.md) for an overview of all four repos.

## Commits, signing, and how we merge

This repository follows the project-wide contribution policy in the
[hub CONTRIBUTING guide](https://github.com/npstorey/civic-ai-tools/blob/main/CONTRIBUTING.md#commits-signing-and-how-we-merge), which is the canonical
text. In short:

- **Sign off every commit — required.** `git commit -s` appends a `Signed-off-by:` line (DCO 1.1;
  what it certifies is in [IPR.md](https://github.com/npstorey/civic-ai-tools/blob/main/IPR.md), adopted per
  [ADR-0017](https://github.com/npstorey/civic-ai-tools/blob/main/docs/adr/0017-ipr-posture-dco-rf-statement.md)). A required `DCO` status check
  enforces it. Forgot? `git rebase --signoff main` fixes a whole branch at once.
- **Sign your commits — encouraged, not required.** SSH or GPG, with the public key registered on your
  GitHub account. Not enforced on any branch
  ([Q74](https://github.com/npstorey/civic-ai-tools/blob/main/docs/architecture/open-questions.md#q74--should-the-default-branches-require-signed-commits)
  records why), but because we never rewrite your commits, your signature is what stays on `main`.
- **Rebase into atomic commits before requesting review.** Each commit should build and pass tests on
  its own. We do not squash at merge time, so your branch lands exactly as you shaped it — and that is
  what keeps `git bisect` useful.
- **We merge with merge commits — never squash, never rebase.** Squash and rebase merges rewrite
  commits, so what lands on `main` is a new object: your signature is replaced by GitHub's and your
  per-commit sign-offs collapse into one commit body. A merge commit is the only method that leaves
  your commits on `main` as the objects you actually made and signed. Reasoning and costs:
  [ADR-0027](https://github.com/npstorey/civic-ai-tools/blob/main/docs/adr/0027-merge-commit-only-vcs-policy.md). To read `main` as one entry per
  pull request, use `git log --first-parent`.

The project's patent posture is the royalty-free statement at [PATENTS.md](https://github.com/npstorey/civic-ai-tools/blob/main/PATENTS.md).

## Questions?

Open an issue with your question — there are no bad questions here.
