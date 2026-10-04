import { POLICY_LINKS, APP_VERSION } from '../lib/legal-links';
import logo from '../assets/logo.png';
import './LegalLinks.css';

/**
 * The phone's replacement for the desktop footer (design_handoff_flexhub_mobile/README.md §Settings):
 * a white card of 44px rows ending with the version/copyright line, shown at the bottom of the Settings
 * hub. Rendered by SettingsPage only below 768px — the footer is its >= 768px counterpart, and exactly
 * one of the two exists at a time (rules.md rule 33).
 *
 * The rows are inert, with no chevron: there are no policy pages yet (lib/legal-links.ts), and a
 * tappable-looking row that does nothing is a dead end for a staff member.
 */
export function LegalLinks() {
  return (
    <section className="legal-links" aria-label="About and legal">
      <ul className="legal-links-list">
        {POLICY_LINKS.map((label) => (
          <li key={label} className="legal-links-row">
            {label}
          </li>
        ))}
      </ul>
      <div className="legal-links-meta">
        <img src={logo} alt="" aria-hidden="true" className="legal-links-logo" />
        <span>Fit &amp; Fine Gym v{APP_VERSION} · © 2026</span>
      </div>
    </section>
  );
}
