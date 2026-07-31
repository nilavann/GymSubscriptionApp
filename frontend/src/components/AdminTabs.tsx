import { NavLink } from 'react-router-dom';
import './AdminTabs.css';

// Pill sub-tab row shared by every admin/data-management screen (frontend/mockups/README.md
// §Settings/Admin) — Hub/Plans/Branches/Users/Roles/Audit Log/Numbering all render this at
// the top so an admin can jump between them without going back through the Settings hub.
const ADMIN_TABS = [
  { label: 'Hub', path: '/settings' },
  { label: 'Plans', path: '/plans' },
  { label: 'Branches', path: '/branches' },
  { label: 'Users', path: '/users' },
  { label: 'Roles', path: '/roles' },
  { label: 'Audit Log', path: '/audit-log' },
  { label: 'Numbering', path: '/member-numbering' },
];

export function AdminTabs() {
  return (
    <nav className="admin-tabs" aria-label="Admin sections">
      {ADMIN_TABS.map((tab) => (
        <NavLink
          key={tab.path}
          to={tab.path}
          className={({ isActive }) => `admin-tab${isActive ? ' admin-tab-active' : ''}`}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
