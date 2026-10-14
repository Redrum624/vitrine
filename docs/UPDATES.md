# Updates

The installed (NSIS setup) copy of Vitrine finds a newer release on GitHub, downloads it and offers
to install it. The code is `electron/updater.cjs`, built on
[electron-updater](https://www.electron.build/auto-update) with its GitHub provider.

## Where the feed comes from

`package.json` `build.publish` is the only place the repository is named:

```json
"publish": { "provider": "github", "owner": "Redrum624", "repo": "vitrine" }
```

Builds still run with `--publish=never`; this block is what makes electron-builder write:

- `release\win-unpacked\resources\app-update.yml` (inside the installed app): provider, owner, repo
  and `updaterCacheDirName`. The updater reads it at run time.
- `release\latest.yml` next to the installer: version, installer file name, size and sha512.

## Release assets the updater needs

Every GitHub Release must carry these (uploaded by `node scripts/gh-release.cjs`):

| Asset | Why |
|---|---|
| `Vitrine-Setup-X.Y.Z.exe` | the installer that is downloaded |
| `latest.yml` | the feed; without it installed copies cannot see the release |
| `Vitrine-Setup-X.Y.Z.exe.blockmap` | lets the updater download only changed blocks |

File names must stay URL-safe (letters, digits, `.`, `_`, `-`): the `url` in `latest.yml` has to be
the real asset name, and GitHub rewrites spaces to dots. That is why the artifacts are
`Vitrine-Setup-X.Y.Z.exe` and `Vitrine-X.Y.Z-portable.exe`.

`scripts/collect-installer.cjs` (last step of `npm run build:win`) copies `latest.yml` and the
blockmap into `installer/` and fails the build if `latest.yml`'s `url`/`path` is not the installer's
name or its `sha512` is not the installer's sha512 (`validateLatestYml`).

The download counter (`.github/scripts/sample-downloads.cjs`) sums only `.exe` assets, because every
installed copy fetches `latest.yml` on each launch.

## Gates

Update checks run only when all of these hold; otherwise the state is logged and nothing is fetched:

| State | Cause |
|---|---|
| `disabled-store` | Microsoft Store (MSIX) build; the Store updates it |
| `disabled-portable` | portable exe (`PORTABLE_EXECUTABLE_DIR` is set) |
| `disabled-dev` | unpackaged run (`npm run electron-dev`) |
| `disabled-no-config` | packaged build without `resources\app-update.yml` (no `build.publish`) |

The check happens once at launch and on **Help > Check for Updates...**. A downloaded update
prompts **Restart and install now** / **Later** (Later installs on the next quit); the restart goes
through the same unsaved-work guard as closing the window. The log is
`%APPDATA%\photo_app\logs\updater.log` (the userData folder is pinned to `photo_app`).

## How to test

1. `npm run build:win`, then check `release\win-unpacked\resources\app-update.yml` and
   `installer\latest.yml`.
2. Install an older release, publish a newer one (with the three assets above), launch the old one
   and watch `updater.log`: `checking`, `update available X`, `update downloaded X`, then the prompt.
3. Run the portable exe and the dev build: the log shows `disabled-portable` / `disabled-dev`.
4. Unit tests: `npx jest src/test/updater.test.ts src/test/releaseScripts.test.ts`.
