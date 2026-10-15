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

## Verify locally (end to end)

`node scripts/update-e2e.cjs` proves the whole path on this machine without GitHub and without touching
the real install. It copies the tracked files into a work folder outside the repository, gives the copy a
test identity, builds 0.1.0 (installer and portable) and 0.1.1 (installer), serves 0.1.1 from
`http://127.0.0.1:<port>/` (a generic feed written into the copy's `build.publish`), installs 0.1.0
silently for the current user, answers the "Update ready" box through UI Automation
(`scripts/ui-answer.ps1`) and checks that the app relaunches as 0.1.1. It also starts the portable exe and
checks that it logs `disabled-portable`, checks nothing and the feed sees no request.

```
node scripts/update-e2e.cjs --stage build --work C:\Dev\e2e-work\vit
node scripts/update-e2e.cjs --stage test --answer now --keep --work C:\Dev\e2e-work\vit
node scripts/update-e2e.cjs --stage test --answer later --work C:\Dev\e2e-work\vit
```

- `--stage build` (about 8 min, resumable) copies, installs dependencies and builds; `--stage test` reuses
  those builds (about 3 min per answer). Plain `--answer now|later` runs both. `--answer manual` waits for a
  person to click. `--preflight` only checks that the profile is clean.
- The work folder must not be under `C:\Windows` (the builds and the installed app do not work there) nor
  inside the repository.
- Identity isolation: the copy's package name, productName, appId, shortcut and artifact names become
  `update-e2e` / `Update E2E` / `com.updatee2e.app`, and every `photo_app`, `com.photoeditorpro.app` and
  `Photo Editor Pro` in its text files is replaced (electron/main.cjs pins userData with
  `app.setName('photo_app')` and logs to `~\Photo Editor Pro\logs`). The run refuses to build while one is
  left. The installed copy keeps its data in `%APPDATA%\update-e2e`, `%LOCALAPPDATA%\update-e2e-updater` and
  `~\Update E2E`. The git-ignored AI model weights are not copied.
- Teardown always runs: stops processes by PID (never by image name), closes the feed, runs the uninstaller,
  removes the three folders above, the HKCU keys and shortcuts, and the work folder (unless `--keep`), then
  checks that none is left. The run refuses to start while any of them exists.
- If a run was interrupted: uninstall `Update E2E` from the Uninstall list (or run `Uninstall Update E2E.exe`
  in the work folder's `install`), delete `%APPDATA%\update-e2e`, `%LOCALAPPDATA%\update-e2e-updater`,
  `~\Update E2E` and the work folder, then rerun.
- The one ERROR line a good run writes is electron-updater's `Cannot download differentially, fallback to
  full download` (only the new version's files are on the feed).
