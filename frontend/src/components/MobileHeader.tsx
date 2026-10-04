import { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../context/auth.context';
import { getInitials } from '../lib/avatar';
import logo from '../assets/logo.png';
import './MobileHeader.css';

/**
 * Mobile top bar (< 768px) — design_handoff_flexhub_mobile/README.md §Mobile shell: logo + brand on
 * the left, the signed-in user's initials on the right. Rendered by AppShell INSTEAD OF the desktop
 * sidebar, never alongside it.
 *
 * The avatar opens a small account menu: name, roles and Sign Out. That is how staff (who cannot
 * reach the admin-only Settings screen) sign out on a phone — the mockup's tab bar has no Sign Out.
 * The menu is only mounted while open, and its document listeners exist only while open.
 */
export function MobileHeader() {
  const { currentProfile, signOut } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Navigating anywhere (including via the browser back button) dismisses the menu.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const name = currentProfile?.full_name ?? '';

  return (
    <header className="mobile-header">
      <div className="mobile-header-brand">
        <img src={logo} alt="" className="mobile-header-logo" aria-hidden="true" />
        <span className="mobile-header-title">Fit &amp; Fine Gym</span>
      </div>

      <div className="mobile-header-account">
        {/* The visible circle is 28px (design); the button around it is 44x44 so it is a real touch target. */}
        <button
          ref={buttonRef}
          type="button"
          className="mobile-header-avatar-button"
          aria-label="Account menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="mobile-header-avatar" aria-hidden="true">
            {getInitials(name)}
          </span>
        </button>

        {open && (
          <div ref={menuRef} id={menuId} className="mobile-header-menu" role="group" aria-label="Account">
            <p className="mobile-header-menu-name">{name}</p>
            {currentProfile && currentProfile.roles.length > 0 && (
              <p className="mobile-header-menu-roles">{currentProfile.roles.join(' · ')}</p>
            )}
            <button
              type="button"
              className="mobile-header-menu-signout"
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
            >
              <LogOut size={18} strokeWidth={2} aria-hidden="true" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
