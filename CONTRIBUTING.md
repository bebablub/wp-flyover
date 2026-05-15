# Contributing to wp-flyover (Flyover GPX)

Thanks for considering a contribution! 🎉  
This repository contains the **Flyover GPX** WordPress plugin (in `flyover-gpx/`) plus supporting materials (e.g., `demo/`). The plugin is described as an MVP built quickly and primarily tested on a single WordPress instance, so improvements—especially around quality, security, and maintainability—are welcome.  
(See the project README for current features, requirements and usage.)  

## Code of Conduct
By participating, you agree to follow the project’s **Code of Conduct**.
If the repository includes `CODE_OF_CONDUCT.md`, please read it before contributing.

---

## Ways to Contribute
You can help in many ways:

- **Bug reports**: find issues on different WP/PHP versions, themes, hosting, or browsers.
- **Fixes**: small PRs that fix a bug, improve readability, or tighten security.
- **Features**: enhancements to the player UX, MapLibre rendering, charts, or admin flows.
- **Documentation**: clarify installation, configuration, shortcode options, screenshots, FAQs.
- **Testing**: confirm fixes and document reproducible steps.

---

## Where to Start
1. Check **Issues** and look for:
   - `good first issue`
   - `help wanted`
2. If you’re proposing a feature, open an issue first so we can align on approach.

---

## Development Setup (Local)

### Requirements
The README lists the baseline requirements (WordPress + PHP versions). [1](https://github.com/bebablub/wp-flyover)

### Recommended local setup
Use any of the following:
- LocalWP, MAMP, Docker, DDEV, XAMPP
- A standard WordPress install with access to `wp-content/plugins`

### Install the plugin from this repo
1. Clone or download this repository.
2. Copy (or symlink) the plugin directory:
   - Place `flyover-gpx/` into your WordPress: `wp-content/plugins/`
3. Install PHP dependencies (if applicable):
   - In the plugin directory, run `composer install`
   - The README shows Composer usage for installing dependencies. [1](https://github.com/bebablub/wp-flyover)
4. Activate in **WordPress → Plugins**.
5. Go to **Settings → Flyover GPX** and upload a `.gpx` file to verify basic function. [1](https://github.com/bebablub/wp-flyover)

> Note: If the project includes JS/CSS tooling (e.g., `package.json`), also run:
> - `npm install`
> - `npm run build` (or `npm run dev`)
> (Only if those scripts exist in the repo.)

---

## Reporting Bugs

When opening a bug report, please include:

- WordPress version
- PHP version
- Browser + OS (for player UI problems)
- Steps to reproduce (minimal, numbered)
- Expected vs. actual behavior
- Screenshots / console logs where relevant
- A sample GPX file (or a link), if you can share it

If the issue is intermittent, mention how often it happens and any patterns you noticed.

### Security issues
Please **do not** open public issues for potential vulnerabilities (REST endpoints, file uploads, permissions, nonce/CSRF, XSS, etc.).  
Instead, report privately to the maintainer via email or another channel listed in the repo.

---

## Making Changes (Pull Requests)

### Workflow
1. **Fork** the repository
2. Create a feature branch:
   - `feature/<short-description>` or `fix/<short-description>`
3. Keep PRs focused: one fix/feature per PR when possible
4. Open a PR against `main`

### PR Checklist
Before submitting:
- [ ] The change is related to an existing issue OR you described the motivation clearly
- [ ] You tested the change locally (see Testing section)
- [ ] You updated docs (README/inline docs) if behavior changed
- [ ] You avoided unrelated formatting churn
- [ ] You considered backwards compatibility where reasonable

### Commit Messages
Use clear messages, e.g.:
- `Fix: prevent crash on empty GPX track`
- `Add: cache weather response for player`
- `Docs: clarify shortcode parameters`

---

## Coding Guidelines (Project Expectations)

### General
- Prefer small, readable functions over cleverness.
- Avoid adding new dependencies unless they bring clear value.
- Keep the plugin stable: validate inputs, handle missing data gracefully.

### WordPress-specific
- **Sanitize** all user inputs and **escape** all outputs.
- Use capability checks for admin features.
- Use nonces for actions (admin forms, AJAX) and permission checks for REST.
- Be mindful of performance: GPX parsing, caching, and large tracks.

### Front-end
- Keep the UI responsive and avoid blocking rendering on large tracks.
- Don’t assume a single theme; test with a default theme if possible.
- Watch the browser console for MapLibre and Chart errors.

---

## Testing

There may not be an automated test suite yet. If you add one, great!  
For now, please do at least a manual smoke test:

1. Activate plugin
2. Upload a small GPX track
3. Embed using the shortcode (copy from Tracks list or use `[flyover_gpx id="..."]`) [1](https://github.com/bebablub/wp-flyover)
4. Verify:
   - map loads
   - play/pause works
   - seeking works (progress bar)
   - chart renders and stays in sync
5. If your change touches admin/settings:
   - verify settings page loads/saves
6. If your change touches REST/cache:
   - verify in browser devtools and/or WP debug logs

---

## Documentation Updates
If you change:
- shortcode parameters
- settings UI
- caching/REST behavior
- installation steps

…please update the README and/or inline documentation accordingly.

---

## License
By contributing, you agree that your contributions will be licensed under the repository’s license (see `LICENSE` in the repo).  

---

## Questions / Discussion
- Use GitHub Issues for questions and proposals.
- If you’re not sure where to start, open an issue and describe what you’d like to work on.
