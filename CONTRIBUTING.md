# Contributing to Open-RAIC

Thank you for your interest in contributing to Open-RAIC! This guide will help you get started and ensure a smooth collaboration.

## How to Contribute

| Contribution type | What to do |
| --- | --- |
| **Bug fix** | Open a PR directly (link the issue if one exists) |
| **Extending existing features** (e.g. adding a new model provider, new TTS engine) | Open a PR directly |
| **New feature or architecture change** | Start in [Discord](https://discord.gg/PtZaaTbH) **before** opening a PR |
| **Design / UI change** | Discuss in Discord first — include mockups or screenshots |
| **Refactor-only PR** | Not accepted unless a maintainer explicitly requests it |
| **Documentation** | Open a PR directly |
| **Question** | Ask in [Discord](https://discord.gg/PtZaaTbH) |

## Coordination While GitHub Intake Is Offline

The `spheng51/RAIC` fork does not currently expose GitHub Issues, Discussions, or Security Advisories. Until those RAIC-owned GitHub surfaces are enabled, use [Discord](https://discord.gg/PtZaaTbH) for bug reports, feature discussion, design review, and maintainer coordination.

- For bounded bug fixes and documentation changes, open a PR directly.
- For larger features, architecture changes, or UI work, coordinate in Discord before writing code.
- If two contributors want the same write scope, coordinate in Discord first rather than racing parallel PRs.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20.9.0
- [pnpm](https://pnpm.io/) (latest)
- A copy of `.env.local` — see [`.env.example`](.env.example) for reference

## Getting Started

```bash
# Clone the repository
git clone https://github.com/spheng51/RAIC.git
cd RAIC

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your API keys

# Start the development server
pnpm dev
```

## Development Workflow

1. **Fork** the repository and create a branch from `main`:
   ```bash
   git checkout -b feat/your-feature main
   ```
   (In this repository's maintainer flow, development in the main shared clone is done in short-lived local `codex/*` scratch branches, merged into local `main`, and then pushed.)
2. **Branch naming convention:**
   - `feat/` — new features or enhancements
   - `fix/` — bug fixes
   - `docs/` — documentation changes
3. Make your changes and **test locally**.
4. Run **all CI checks** before committing (see below).
5. Open a **Pull Request** against `main`.

### Maintainer Workflow (single shared branch)

This repository's default branch workflow is `main`-centric.

1. Work in short-lived local `codex/*` scratch branches.
2. Merge a validated slice into local `main`.
3. Run `pnpm run ops:drift` and `pnpm run ops:verify` before pushing `main`.
4. Remove the scratch branch locally after merge.

## Before You Submit a PR

Run the following checks locally — CI will run them too, but catching issues early saves everyone time:

```bash
# 1. Format code
pnpm format

# 2. Lint (with auto-fix)
pnpm lint --fix

# 3. TypeScript type checking
npx tsc --noEmit
```

For maintainer release slices, use the repo runbook baseline instead:

```bash
pnpm run ops:verify
```

For behavior slices that may affect perf-critical classroom paths, attach benchmark evidence if a deterministic harness exists for that path.

If formatting or lint auto-fixes produce changes, include them in your commit.

### Local Testing

Before marking a PR as **Ready for Review**, you **must**:

1. **Verify your goal** — confirm that the PR achieves what it set out to do (bug is fixed, feature works as expected, etc.)
2. **Regression test** — manually check that existing functionality is not broken by your changes (e.g. navigate key flows, verify related features still work)
3. **Run CI checks locally** (see above)

If you have not completed local verification, keep your PR in **Draft** status. Only move it to Ready for Review once you are confident it works and does not regress other features.

### PR Guidelines

- **Keep PRs focused** — one concern per PR; do not mix unrelated changes
- **Describe what and why** — fill out the [PR template](.github/pull_request_template.md)
- **Include screenshots** — for UI changes, show before/after
- **Ensure CI passes** before requesting review
- **All UI text must be internationalized (i18n)** — do not hardcode user-facing strings

## Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`, `style`

Examples:

```
feat(tts): add Azure TTS provider
fix(whiteboard): prevent canvas from resetting on window resize
docs: add CONTRIBUTING.md
```

## AI-Assisted PRs 🤖

PRs built with AI tools (Codex, Claude, Cursor, etc.) are welcome! We just ask for transparency and self-review:

- **Mark it** — note in the PR title or description that the PR is AI-assisted
- **AI-review your own code first** — before requesting maintainer review, run an AI code review (e.g. Claude, Codex, Copilot) on your changes and address the findings. This is **required** for AI-assisted PRs to avoid dumping large amounts of unreviewed generated code on maintainers.
- **You are responsible for what you submit** — understand the code, not just the prompt.

AI-assisted PRs are held to the same quality standard as any other PR. Community members are also encouraged to leave constructive feedback on any PR — peer review helps everyone improve.

## Project Structure

```
Open-RAIC/
├── app/              # Next.js app router pages and API routes
├── components/       # React components
├── lib/              # Shared utilities and core logic
├── packages/         # Internal packages (mathml2omml, pptxgenjs)
├── public/           # Static assets
├── messages/         # i18n translation files
└── .github/          # Issue templates, PR template, CI workflows
```

## Reporting Bugs

Until RAIC GitHub issues are enabled, report bugs in [Discord](https://discord.gg/PtZaaTbH). Include:

- Steps to reproduce
- Expected vs. actual behavior
- Browser / OS / Node version
- Screenshots or error logs if applicable

## Requesting Features

Until RAIC GitHub issues and discussions are enabled, use [Discord](https://discord.gg/PtZaaTbH) for feature requests and architecture discussion.

## Security Vulnerabilities

Follow [SECURITY.md](SECURITY.md) for private vulnerability reporting. **Do not** open a public issue or post vulnerability details in a public Discord channel.

## License

By contributing to Open-RAIC, you agree that your contributions will be licensed under the [AGPL-3.0 License](LICENSE).
