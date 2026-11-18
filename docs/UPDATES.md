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

## Release checklist

An installed copy finds a release only through GitHub's "latest" release (`/releases/latest`) and
that release's `latest.yml`. A release left as draft or prerelease, missing one of the three assets,
or carrying a `latest.yml` that does not describe the uploaded installer is invisible or unverifiable
for every installed copy, and a failed automatic check shows the user nothing.

What `node scripts/gh-release.cjs` checks (the checks are in `scripts/release-assets.cjs`):

1. Before anything is uploaded: the installer, its blockmap and `latest.yml` are in `release\`;
   `release\latest.yml` names `Vitrine-Setup-X.Y.Z.exe` in `path` and `files[].url`, carries its
   sha512 and size, and its `version` is `package.json`'s. Any error: exit 1, nothing published.
2. After `gh release create` (or `upload --clobber`): it reads the release back with
   `gh release view vX.Y.Z --json isDraft,isPrerelease,tagName,assets` (not a draft, not a
   prerelease, tag `vX.Y.Z`, the three assets present and `uploaded`, the installer's size equal to
   the local one, `latest.yml` not empty), then reads the live feed the way electron-updater does
   (`https://github.com/<owner>/<repo>/releases/latest` as JSON for the tag, then
   `/releases/download/<tag>/latest.yml`): the latest tag is `vX.Y.Z`, the live `latest.yml` says
   `version: X.Y.Z`, its `path` and `files[0].url` are assets of the release and `files[0].size`
   is that asset's size. Any failed check is printed and the script exits 1; `SUCCESS` is printed
   only when every check passes. Owner and repo come from `build.publish`.

The same read-back runs on its own, read-only, at any time:

```
node scripts/check-update-feed.cjs                  # the package.json version
node scripts/check-update-feed.cjs --version 1.40.0
```

It prints one `PASS`/`FAIL` line per check and exits 0 only when all pass. It has no local installer,
so it skips the installer size check (the `files[0].size` check still compares the feed with the
asset). Run it again after a fix on GitHub, or whenever updates look stuck.

Then the hand check, once per release:

1. Keep one install of the previous version (an NSIS setup install, not the portable exe).
2. After publishing, launch it and read `%APPDATA%\photo_app\logs\updater.log`. In order:
   `update available X.Y.Z`, `update downloaded X.Y.Z`, then the **Update ready** prompt; answer
   **Restart and install now**: `installing X.Y.Z`; after the relaunch, `started Vitrine X.Y.Z`.

**A changed build gets a new version, never a re-upload under the same version.** Installed copies
compare only the version in `latest.yml` with their own (electron-updater takes an update only when
it is newer): a copy that already has X.Y.Z never fetches a second X.Y.Z.

## Known limits

- The check runs once at launch and on **Help > Check for Updates...**. A copy left running does not
  notice a release until it is restarted or the menu item is used.
- A per-machine ("for all users") install raises a Windows permission (UAC) prompt on every update,
  including the install at quit after **Later**. That path has never been tested.
- The installer is unsigned (`win.verifyUpdateCodeSignature` is false); the integrity of an update
  rests on the sha512 in `latest.yml`, which electron-updater checks after the download.

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
   and watch `updater.log`: `checking`, `update available X`, `update downloaded X`, then the prompt
   (the full hand check is in "Release checklist").
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
