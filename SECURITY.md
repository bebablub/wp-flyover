# Security Policy

## Supported Versions

Security updates are provided for the latest stable minor release line and the `main` branch.

| Version | Supported |
| ------- | --------- |
| 1.3.x   | ✅ |
| < 1.3   | ❌ |

> Notes:
> - The current plugin version is maintained in the code as `FGPX_VERSION` (e.g., `1.3.0`).  
> - If you are running an older version, please upgrade before reporting issues.

## Reporting a Vulnerability

Please **do not** report security issues via public GitHub Issues, discussions, or pull requests.

Instead, report vulnerabilities privately using one of the following options:

1. **GitHub Security Advisories (preferred)**  
   Use the repository’s **Security → Advisories → “Report a vulnerability”** flow if available.

### What to include in your report
To help triage quickly, please include:
- A clear description of the vulnerability and potential impact
- Steps to reproduce (proof-of-concept if possible)
- Affected version(s) and environment details (WordPress version, PHP version, browser if UI-related)
- Any relevant logs or screenshots
- Whether you’ve identified a possible fix/mitigation

### Response timeline
- **Acknowledgement:** within **48 hours**
- **Status updates:** at least every **7 days** while investigating
- **Fix target:** best effort; severity and complexity determine timing

### Coordinated disclosure
Please allow time for investigation and a fix before public disclosure. If you believe the issue is urgent (e.g., active exploitation), mention that explicitly so mitigation can be prioritized.

## Security Best Practices for Users

Because this is a WordPress plugin that handles file uploads/parsing and exposes functionality via endpoints and front-end rendering, keep these general best practices in mind:
- Keep WordPress core, themes, and plugins up to date
- Use least-privilege accounts and strong admin credentials
- Avoid installing from untrusted sources; deploy from a known commit/tag
- Enable backups and monitor logs for unusual activity

## Scope

This policy covers security issues in:
- The WordPress plugin code (PHP, JS/CSS assets)
- REST/AJAX endpoints and permissions checks
- File upload/parsing paths (e.g., GPX handling)
- Build/dependency configuration shipped with the plugin

## Attribution

This policy is inspired by common open-source security disclosure practices and GitHub’s recommended private reporting workflows.
