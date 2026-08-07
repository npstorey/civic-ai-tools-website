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

## Guidelines

- Keep changes focused — one fix or feature per PR
- Test your changes before submitting
- Update documentation if your change affects setup or usage
- Be respectful in issues and pull requests

## This is a multi-repo project

This website is one part of a larger project. If you're unsure where to contribute, see the [civic-ai-tools CONTRIBUTING guide](https://github.com/npstorey/civic-ai-tools/blob/main/CONTRIBUTING.md) for an overview of all four repos.

## Legal: sign-off and IPR

- Every contribution requires a Developer Certificate of Origin sign-off: commit with `git commit -s`, which adds a `Signed-off-by: Your Name <email>` line. What that certifies, and the project-wide policy: [IPR.md](https://github.com/npstorey/civic-ai-tools/blob/main/IPR.md) (hub repo; adopted per [ADR-0017](https://github.com/npstorey/civic-ai-tools/blob/main/docs/adr/0017-ipr-posture-dco-rf-statement.md)).
- The project's patent posture is the royalty-free statement at [PATENTS.md](https://github.com/npstorey/civic-ai-tools/blob/main/PATENTS.md).

## Questions?

Open an issue with your question — there are no bad questions here.
