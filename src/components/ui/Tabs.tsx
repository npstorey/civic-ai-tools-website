'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

/**
 * P8 · Tabs (UX-1 P0; design §2 P8). Semantics: `role="tablist"`,
 * `role="tab"`, `aria-selected`. Look: the selected tab underlined 2 px
 * `--accent`, text 14 px, in a flex row that wraps at narrow width.
 *
 * States: idle; hover (CSS); selected; disabled-with-reason. A disabled tab
 * stays focusable, carries `aria-disabled`, and is described by its reason
 * (shown as a second line).
 *
 * Keyboard: ArrowLeft and ArrowRight move among the enabled tabs, wrapping at
 * the ends; Home and End go to the first and last. Each move selects the tab
 * (automatic activation) and focuses it. Only the selected tab is in the tab
 * order (a roving tabindex). The selection is the caller's (`selectedId`,
 * `onSelect`), so a page that syncs it to `?tab=` keeps doing so.
 *
 * Every word is the caller's.
 */

export interface TabItem {
  id: string;
  /** The tab's words, count included, supplied by the caller. */
  label: ReactNode;
  /** Disabled-with-reason: the tab's feature is not offered, and this says why. */
  disabledReason?: ReactNode;
}

export interface TabsProps {
  /** The tablist's accessible name. */
  label: string;
  tabs: TabItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** The selected tab's panel. */
  children?: ReactNode;
  /** Prefix for the tab and panel ids; default from `useId`. */
  idPrefix?: string;
}

function present(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

export function Tabs({ label, tabs, selectedId, onSelect, children, idPrefix }: TabsProps) {
  const autoId = useId();
  const prefix = idPrefix ?? autoId;
  const listRef = useRef<HTMLDivElement>(null);
  const panelId = `${prefix}-panel`;
  const tabId = (id: string) => `${prefix}-tab-${id}`;
  const reasonId = (id: string) => `${prefix}-reason-${id}`;
  const hasPanel = children !== undefined;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = tabs.map((tab, index) => ({ tab, index })).filter(({ tab }) => !present(tab.disabledReason));
    if (enabled.length === 0) return;
    const current = enabled.findIndex(({ tab }) => tab.id === selectedId);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = current < 0 ? 0 : (current + 1) % enabled.length;
        break;
      case 'ArrowLeft':
        next = current < 0 ? enabled.length - 1 : (current - 1 + enabled.length) % enabled.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = enabled.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = enabled[next];
    onSelect(target.tab.id);
    const buttons = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
    buttons?.[target.index]?.focus();
  };

  return (
    <>
      <div role="tablist" aria-label={label} className="ui-tabs" ref={listRef} onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const selected = tab.id === selectedId;
          const disabled = present(tab.disabledReason);
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              className="ui-tab"
              aria-selected={selected}
              aria-controls={selected && hasPanel ? panelId : undefined}
              aria-disabled={disabled || undefined}
              aria-describedby={disabled ? reasonId(tab.id) : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={disabled ? undefined : () => onSelect(tab.id)}
            >
              <span className="ui-tab-label">{tab.label}</span>
              {disabled ? (
                // Hidden from the tab's name, read as its description.
                <span id={reasonId(tab.id)} className="ui-tab-reason" aria-hidden="true">
                  {tab.disabledReason}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {hasPanel ? (
        <div role="tabpanel" id={panelId} aria-labelledby={tabId(selectedId)} className="ui-tabs-panel" tabIndex={0}>
          {children}
        </div>
      ) : null}
    </>
  );
}
