'use client';

import { Menu } from '@/components/ui/Menu';

/**
 * UX-2 P6 (#729; contract p6p10.md item 2, criterion 1): the directory's one filter control, on the site's `Menu`
 * (`size="field"`, `kind="radio"`), shared by both tabs. Its trigger reads the chosen option's words, or `label`
 * when none is chosen (an option whose value is empty is the "All …" choice). Menu carries the keyboard, Escape,
 * the outside click and the panel's placement; every word is the caller's.
 */

export interface FilterOption {
  value: string;
  label: string;
}

/** A Menu item id may not be empty: the empty value (no filter) takes this id. */
const ALL = '__all__';
const idOf = (value: string) => (value === '' ? ALL : value);

export default function FilterDropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}) {
  const selectedLabel = options.find((o) => o.value === value)?.label || label;
  // A field menu fills its container; in the filter row each control keeps its own width.
  return (
    <div className="directory-filter">
      <Menu
        size="field"
        kind="radio"
        trigger={selectedLabel}
        selectedId={idOf(value)}
        items={options.map((o) => ({ id: idOf(o.value), label: o.label }))}
        onSelect={(id) => onChange(id === ALL ? '' : id)}
      />
    </div>
  );
}
