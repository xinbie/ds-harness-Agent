# CLAUDE.md

See [AGENTS.md](AGENTS.md) for the repository-wide working rules.

Short version: this is a Cordis "everything is a plugin" harness modeled on DeepSeek Harness.
Read [docs/architecture.md](docs/architecture.md) first, keep seams split into
Definition/Provider/Consumer, and back behavior changes with specs under the owning package's
`tests/` directory.
