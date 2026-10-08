import { ArrowUp, ArrowDown } from 'lucide-react';
import type { ReactNode } from 'react';

interface SortableThProps {
  label: ReactNode;
  /** whether this column is the active sort key */
  active: boolean;
  asc: boolean;
  onSort: () => void;
}

/**
 * Sortable table header cell with keyboard support and aria-sort,
 * replacing the bare `<th onClick>` pattern across list pages.
 */
export function SortableTh({ label, active, asc, onSort }: SortableThProps) {
  return (
    <th
      className="sortable"
      role="button"
      tabIndex={0}
      aria-sort={active ? (asc ? 'ascending' : 'descending') : 'none'}
      onClick={onSort}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSort();
        }
      }}
    >
      {label}
      {active ? (
        <span className="sort-ind">{asc ? <ArrowUp size={11} /> : <ArrowDown size={11} />}</span>
      ) : null}
    </th>
  );
}
