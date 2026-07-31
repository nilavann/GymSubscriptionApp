import { Dumbbell } from 'lucide-react';
import './AppFooter.css';

// frontend/mockups/README.md §Footer: logo + brand + tagline, a row of policy links, and a
// copyright line, shown on every page. This app has no Privacy/Terms/Refund/Support pages
// or routes yet, so those render as inert labels rather than dead `<a href="#">` links.
const POLICY_LINKS = ['Privacy Policy', 'Terms of Use', 'Refund Policy', 'Support'];

export function AppFooter() {
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <div className="app-footer-brand-row">
          <span className="app-footer-logo-tile" aria-hidden="true">
            <Dumbbell size={16} strokeWidth={2} />
          </span>
          <div>
            <span className="app-footer-brand">Fit &amp; Fine</span>
            <span className="app-footer-tagline">Fit &amp; Fine Gym member management · v1.0.0</span>
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
