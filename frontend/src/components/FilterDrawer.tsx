import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import './FilterDrawer.css';

// Generic right-slide filter panel shell (frontend/mockups/README.md's Members-list
// Filters drawer) — the caller supplies its own filter-group content as children;
// this component only owns the open/close/backdrop/footer chrome.
interface FilterDrawerProps {
  open: boolean;
  title?: string;
  onClose: () => void;
  onClear: () => void;
  children: ReactNode;
}

export function FilterDrawer({ open, title = 'Filters', onClose, onClear, children }: FilterDrawerProps) {
  if (!open) return null;

  return (
    <div className="filter-drawer-backdrop" onClick={onClose}>
      <div
        className="filter-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="filter-drawer-header">
          <h2 className="filter-drawer-title">{title}</h2>
          <button type="button" className="filter-drawer-close" onClick={onClose} aria-label="Close filters">
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div className="filter-drawer-body">{children}</div>

        <div className="filter-drawer-footer">
          <button type="button" className="filter-drawer-clear" onClick={onClear}>
            Clear all
          </button>
          <button type="button" className="filter-drawer-apply" onClick={onClose}>
            Apply filters
          </button>
        </div>
      </div>
    </div>
  );
}
