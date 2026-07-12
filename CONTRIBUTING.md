# Contributing to Vitrine

Thanks for your interest in Vitrine! Contributions — bug reports, feature ideas,
and pull requests — are welcome.

## Reporting bugs & requesting features

Please open a [GitHub issue](https://github.com/Redrum624/Vitrine/issues) using the
appropriate template. For bugs, include your Windows version, the camera/file format
involved (if relevant), steps to reproduce, and what you expected vs. what happened.

## Development setup

Requires **Node.js 18+** (the repo uses **pnpm**; npm also works). Windows is the
supported target.

```bash
git clone https://github.com/Redrum624/Vitrine.git
cd Vitrine
pnpm install
pnpm run electron-dev   # Vite dev server + Electron
```

Useful scripts:

```bash
pnpm run typecheck   # tsc --noEmit
pnpm run lint        # eslint (0 problems required)
pnpm run test        # jest
pnpm run build:win   # produce a Windows installer in installer/
```

## Pull requests

1. Create a feature branch: `git checkout -b feat/your-feature` (or `fix/…`, `chore/…`).
2. Keep changes focused and add tests where it makes sense.
3. Ensure `pnpm run typecheck`, `pnpm run lint`, and `pnpm run test` all pass — CI runs
   these on every PR and must be green.
4. Use clear commit messages (Conventional Commits style: `feat:`, `fix:`, `chore:` …).
5. Open the PR against `main` and fill in the template.

## License of contributions

Vitrine is released under the [PolyForm Noncommercial License 1.0.0](LICENSE). By
submitting a contribution you agree it is licensed under the same terms. Bundled
third-party components keep their own licenses (see
[THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)).
