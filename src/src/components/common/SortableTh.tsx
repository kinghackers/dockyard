import { ArrowUp, ArrowDown } from 'lucide-react';
import type { ReactNode } from 'react';

interface SortableThProps {
  label: ReactNode;
  /** whether this column is the active sort key */
  active: boolean;
  asc: boolean;
  onSort: () => void;
  /** cell alignment; numeric columns (size, counts) read better right-aligned */
  align?: 'left' | 'right';
}

/**
 * Sortable table header cell with keyboard support and aria-sort,
 * replacing the bare `<th onClick>` pattern across list pages.
 */
export function SortableTh({ label, active, asc, onSort, align = 'left' }: SortableThProps) {
  return (
    <th
      className="sortable"
      role="button"
      tabIndex={0}
      aria-sort={active ? (asc ? 'ascending' : 'descending') : 'none'}
      style={align === 'right' ? { textAlign: 'right' } : undefined}
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
