# Microsoft Store distribution (MSIX)

Vitrine ships through two channels:

| Channel | Package | Signing | SmartScreen | Updates |
|---|---|---|---|---|
| GitHub Releases | NSIS installer (`Vitrine Setup X.Y.Z.exe`) | unsigned | "Windows protected your PC" until reputation accrues | manual |
| Microsoft Store | MSIX (`Vitrine X.Y.Z.appx`) | **signed by Microsoft** | none | automatic |

Both installs use the **same** user data. Verified empirically on Windows 11 (see
"Data continuity" below): the packaged app reads and writes the real
`%APPDATA%\photo_app`, so edits, presets and the RAW base cache carry over in both
directions between the GitHub install and the Store install.

## One-time setup (account owner)

1. Register a **Partner Center individual developer account** ($19 one-time):
   <https://partner.microsoft.com/dashboard/registration> — pick *Individual*. The
   **publisher display name** you choose (e.g. "Vitrine") is what users see; your
   legal name is not shown on the listing.
2. In Partner Center: **Apps and games → New product → MSIX or PWA app**, reserve the
   name **Vitrine**.
3. Open the product's **Product management → Product identity** page and copy the
   three values into `store-identity.json` at the repo root (gitignored — never
   commit it):

   ```json
   {
     "identityName":        "<Package/Identity/Name>",
     "publisher":           "<Package/Identity/Publisher, the CN=... GUID string>",
     "publisherDisplayName": "<Package/Properties/PublisherDisplayName>"
   }
   ```

## Building the Store package

```
npm run build:store
```

Produces `release/Vitrine <version>.appx`, **unsigned by design** — the Store signs
it during ingestion ("AppX is not signed  reason=Windows Store only build" in the
build log is expected). Without `store-identity.json` the script builds with
clearly-labeled LOCAL TEST identity values for validation only; it prints which mode
it used. The package version is derived from `package.json` (`1.24.1` → `1.24.1.0`).

## Submitting

1. Partner Center → the product → **Start submission**, upload the `.appx`.
2. `runFullTrust` is a restricted capability that MSIX desktop apps declare by
   default; the submission form asks for a justification — "desktop photo editor
   (Electron); needs full-trust file system access to the user's photo library" is
   accurate.
3. **Availability: prefer Windows 11 only.** On Windows 10, MSIX virtualizes
   `%APPDATA%` into the package container, so a Windows 10 Store install would NOT
   share data with the NSIS install (and would lose its edits on uninstall).
   Windows 10 users should use the GitHub installer. See "Data continuity".
4. Screenshots: reuse `docs/` marketing shots (min 1366×768 for desktop listings).
5. Certification typically takes 1–3 business days. Later releases can script this
   step with the `msstore` CLI (Microsoft Store Developer CLI) if it gets tedious.

## Data continuity (verified 2026-07-13, Windows 11 26200)

`scripts/msix-smoke.cjs` was run against a **properly installed, signed** test
package (real app-model activation via an AppExecutionAlias — see the script header
for why lesser launch methods prove nothing). Result: **11/11 checks passed.**

- Writes from the Store build land in the **real** `%APPDATA%\photo_app` — no
  container copy is created (no AppData virtualization for this full-trust package
  on Windows 11).
- Pre-existing NSIS-era **edits** (per-image sidecars in `userData/store/`) and
  **presets** (Chromium `localStorage`) are readable from the Store build and
  survive restarts.
- The RAW **base cache** is shared too (a warm cache from the NSIS install speeds up
  the Store install's first open, and vice versa).
- App logs also remain shared (`~\Photo Editor Pro\logs`, outside AppData).

Caveats:

- **Windows 10 behaves differently** (AppData IS virtualized there) — hence the
  Windows 11-only availability recommendation above.
- The app takes no single-instance lock, so running the NSIS and Store builds
  *simultaneously* has both processes sharing one Chromium profile (the second
  instance's localStorage writes may not persist). Sequential use is fine. If this
  ever bites, `app.requestSingleInstanceLock()` is the fix.
- The verified package was signed with a local test certificate (`SignatureKind:
  Developer`). Behavior with the Store signature is expected to be identical; after
  the first Store release, re-run the harness against the installed Store build for
  a `SignatureKind: Store` datapoint (no alias needed if only checking data paths by
  hand, or repeat the recipe below).

## Local validation recipe (per release, before submitting)

The harness needs a *real install* (loose `-Register` layouts skip virtualization
semantics and direct exe launches don't even get package identity — both produce
meaningless results; the script aborts if it detects them).

1. `npm run build:store` (test identity is fine for this).
2. Unpack: `makeappx unpack /p "release\Vitrine <v>.appx" /d release\msix-layout /o`
   (makeappx from the Windows SDK).
3. Edit `release\msix-layout\AppxManifest.xml`: add the `uap5` namespace and, inside
   `<Application>`, an execution alias so the harness can activate through the real
   app model *with* a CDP port:

   ```xml
   xmlns:uap5="http://schemas.microsoft.com/appx/manifest/uap/windows10/5"
   ...
   <Extensions>
     <uap5:Extension Category="windows.appExecutionAlias" Executable="app\Vitrine.exe" EntryPoint="Windows.FullTrustApplication">
       <uap5:AppExecutionAlias><uap5:ExecutionAlias Alias="vitrine-msix-test.exe" /></uap5:AppExecutionAlias>
     </uap5:Extension>
   </Extensions>
   ```
4. Delete `release\msix-layout\AppxBlockMap.xml`, repack:
   `makeappx pack /d release\msix-layout /p release\VitrineSignedTest.appx /o`
5. Self-sign and trust (ONE elevated import; the cert is throwaway):
   ```powershell
   $cert = New-SelfSignedCertificate -Type Custom -Subject 'CN=Vitrine Local Test' -KeyUsage DigitalSignature -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3','2.5.29.19={text}') -CertStoreLocation Cert:\CurrentUser\My
   signtool sign /fd SHA256 /sha1 $cert.Thumbprint release\VitrineSignedTest.appx
   Export-Certificate -Cert $cert -FilePath $env:TEMP\vitrine-test.cer
   # elevated: Import-Certificate -FilePath $env:TEMP\vitrine-test.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
   Add-AppxPackage release\VitrineSignedTest.appx
   ```
6. Run the harness (pick a fixture that HAS saved edits so the migration check is
   meaningful — the harness tells you if it doesn't):
   ```
   node scripts/msix-smoke.cjs --alias vitrine-msix-test.exe --pfn <PackageFamilyName from Get-AppxPackage>
   ```
7. Clean up: `Remove-AppxPackage`, remove the test cert from
   `Cert:\LocalMachine\TrustedPeople` (elevated) and `Cert:\CurrentUser\My`.

Traps (each cost a debugging round — details in the `scripts/msix-smoke.cjs` header):

- Unsigned MSIX cannot be installed for full-trust apps at all (`0x80073D2B`), and
  the unsigned-namespace OID trick doesn't help — hence the self-sign step.
- Never hand-delete `%LOCALAPPDATA%\Packages\<PFN>\LocalCache` while the package is
  registered: activation wedges (hangs forever). Reset = `Remove-AppxPackage` +
  reinstall.
- `Invoke-CommandInDesktopPackage` grants package identity but is a debug context —
  don't use it to judge virtualization behavior.

## winget

The GitHub NSIS release is also published to the winget community repo
(`winget install vitrine`, PackageIdentifier `Redrum624.Vitrine`). Per release,
bump the manifest: new version folder under
`manifests/r/Redrum624/Vitrine/<version>/` in a fork of `microsoft/winget-pkgs`
with the new installer URL + SHA256, then PR (or `wingetcreate update
Redrum624.Vitrine --urls <installer-url> --version <version> --submit`, verifying
the commit uses the noreply identity).
