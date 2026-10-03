import logo from '../assets/logo.png';
import { APP_VERSION, POLICY_LINKS } from '../lib/legal-links';
import './AppFooter.css';

// frontend/mockups/README.md §Footer: logo + brand + tagline, a row of policy links, and a
// copyright line. Shown at >= 768px only; on a phone the same labels live in Settings (LegalLinks).
// This app has no Privacy/Terms/Refund/Support pages or routes yet, so those render as inert labels
// rather than dead `<a href="#">` links — see lib/legal-links.ts.

export function AppFooter() {
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <div className="app-footer-brand-row">
          <img src={logo} alt="" className="app-footer-logo" aria-hidden="true" />
          <div>
            <span className="app-footer-brand">Fit &amp; Fine</span>
            <span className="app-footer-tagline">Fit &amp; Fine Gym member management · v{APP_VERSION}</span>
          </div>
        </div>

        <div className="app-footer-links">
          {POLICY_LINKS.map((label) => (
            <span key={label} className="app-footer-link">
              {label}
            </span>
          ))}
        </div>

        <p className="app-footer-copyright">© 2026 Fit &amp; Fine Gym. All rights reserved.</p>
      </div>
    </footer>
  );
}
