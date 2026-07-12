# Security Policy

## Supported versions

Vitrine is an actively developed desktop application. Security fixes target the
**latest released version** only. Please make sure you're on the newest
[release](https://github.com/Redrum624/Vitrine/releases/latest) before reporting.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, report privately through GitHub's
[**Report a vulnerability**](https://github.com/Redrum624/Vitrine/security/advisories/new)
form (Security → Advisories). This keeps the details private until a fix is available.

Please include:

- A description of the issue and its potential impact.
- Steps to reproduce (a proof of concept if possible).
- The Vitrine version and your Windows version.

You'll receive an acknowledgement, and I'll work with you on a fix and coordinated
disclosure. As a non-commercial hobby project there is no bug-bounty program, but
credit will gladly be given in the release notes.

## Scope notes

Vitrine runs locally and processes image files. It has no account system, sends no
telemetry, and makes no network requests during normal editing. The most relevant
attack surface is malformed image/RAW files and the local file-write paths; reports
in those areas are especially appreciated.
