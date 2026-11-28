'use client';

/**
 * The configured sources by group (S4 W2a, npstorey/civic-ai-tools#335; criteria B1 and B2; C1 = A, C2 = B, C6 = B),
 * for Settings' Data sources tab and the picker's list: one component, so the two lists group the same way.
 *
 * A GROUP is two or more configured sources reached through one server (`readerBlocks`, by class). Its head carries its
 * name (S42), its count (S1), one control (two equal buttons, named S3), what the control does (S2), and, when the
 * control shows neither button pressed, a line counting the sources by state (S4). A group of twelve or fewer shows its
 * rows under the head; a larger group is closed until opened (S5), a native disclosure, so every row and its "More about
 * this source" are two actions away. A source alone is its own row, as before.
 *
 * THE GROUP'S CONTROL writes the state of every source then in the group that is not set on its own, in one write
 * (`setClassState`, S4 W1's class write), and the line under it says what changed and how many sources it covers (S6),
 * how many set on their own it left (S7), or that nothing changed (S8). Before a consent the states are kept on the
 * page and nothing is confirmed (R9 P2). A refusal because the cookie is full reads S24 (and S25), as a row's does.
 *
 * THE MARK (S10) is on a row set on its own inside a group (`renderRow`'s `marked`).
 */

import { useState, type ReactNode } from 'react';
import type { FlowsSource } from '@/lib/flows/statement';
import { GROUP_TEXT, type GroupCounts } from '@/lib/sources/copy';
import { readerBlocks, type ReaderBlock } from '@/lib/sources/reader-groups';
import { EnableDisableButtons, groupOutcome, refusedLine, useLineId, type ConfirmedChange } from './SourceStateControl';
import { canPauseToAsk, type ConsentSnapshot, type SourceStateValue } from './useSourceConsent';

/** Above this many sources a group's rows are closed until opened (C1 = A). */
export const OPEN_GROUP_LIMIT = 12;

export interface SourceGroupsProps {
  /** The configured sources to list, in the statement's order. */
  sources: readonly FlowsSource[];
  /** The states each source shows (`panelStates`). */
  states: Record<string, SourceStateValue>;
  /** The sources set on their own (`ownSources`). */
  own: ReadonlySet<string>;
  consent: Pick<ConsentSnapshot, 'routing' | 'store' | 'writing' | 'status'> & {
    setClassState: (classId: string, members: readonly string[], state: SourceStateValue) => Promise<boolean>;
  };
  confirmed: ConfirmedChange;
  setConfirmed: (change: ConfirmedChange) => void;
  /** One source's row (`SourceRow`), `marked` when it is set on its own inside a group. */
  renderRow: (source: FlowsSource, marked: boolean) => ReactNode;
  /** A group to show open (the one holding a source Settings was opened for). */
  openGroup?: string | null;
  /** The list's own attributes. */
  listProps?: Record<string, unknown>;
}

const ROW = { padding: '8px 0', borderTop: '1px solid var(--border-color)' } as const;

function countsOf(ids: readonly string[], states: Record<string, SourceStateValue>): GroupCounts {
  const of = (state: SourceStateValue) => ids.filter((id) => (states[id] ?? 'ask-first') === state).length;
  return { on: of('on'), askFirst: of('ask-first'), off: of('off') };
}

function GroupBlock({ block, props }: { block: Extract<ReaderBlock, { kind: 'group' }>; props: SourceGroupsProps }) {
  const { states, own, consent, confirmed, setConfirmed, renderRow, openGroup } = props;
  const [toggled, setToggled] = useState<boolean | null>(null);
  const setsId = useLineId('group-sets');
  const statesId = useLineId('group-states');
  const ids = block.members.map((m) => m.sourceId);
  const n = ids.length;
  const counts = countsOf(ids, states);
  const pressed = counts.on === n ? 'on' : counts.off === n ? 'off' : null;
  const large = n > OPEN_GROUP_LIMIT;
  const open = toggled ?? openGroup === block.classId;
  const rowsShown = !large || open;
  const line = pressed === null ? GROUP_TEXT.statesLine(counts, rowsShown, canPauseToAsk(consent)) : '';
  const ownCount = ids.filter((id) => own.has(id)).length;
  const mine = confirmed !== null && 'group' in confirmed && confirmed.group === block.classId ? confirmed : null;
  const inForce = consent.status?.inForce === true;
  const rows = <ul style={{ listStyle: 'none', margin: 0, padding: '0 0 0 16px' }}>{block.members.map((member) => renderRow(member, own.has(member.sourceId)))}</ul>;
  return (
    <li data-group={block.classId} style={{ ...ROW, borderBottom: '1px solid var(--border-color)' }}>
      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{block.name}</div>
      <div data-part="group-count">{GROUP_TEXT.count(n)}</div>
      <EnableDisableButtons
        name={GROUP_TEXT.controlName(block.name, n)}
        pressed={pressed}
        disabled={consent.writing}
        describedBy={line ? `${setsId} ${statesId}` : setsId}
        onChoose={(state) => {
          setConfirmed(null);
          // Counted before the write: a source set on its own to another setting is left as it is (premise 7).
          const left = ids.filter((id) => own.has(id) && (states[id] ?? 'ask-first') !== state).length;
          const said = GROUP_TEXT.changed(n - left, left, block.reached, state === 'on' ? 'enabled' : 'disabled');
          // Before a consent the choice is kept, not written: nothing to confirm (R9 P2).
          const writes = inForce;
          void consent.setClassState(block.classId, ids, state).then((ok) => {
            if (writes) setConfirmed(groupOutcome(ok, block.classId, said));
          });
        }}
      />
      <div id={setsId} data-part="group-sets">{GROUP_TEXT.sets(n, ownCount)}</div>
      {line && <div id={statesId} data-part="group-states">{line}</div>}
      {mine && <div role="status" data-part="group-changed">{'refused' in mine ? refusedLine(mine.accounts) : mine.line}</div>}
      {large ? (
        <details open={open} onToggle={(event) => setToggled((event.currentTarget as HTMLDetailsElement).open)} style={{ marginTop: '4px' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>{GROUP_TEXT.disclosure(n)}</summary>
          {rows}
        </details>
      ) : (
        rows
      )}
    </li>
  );
}

/** The list: each group's block and each source alone, in the order of the statement's first member of each. */
export default function SourceGroups(props: SourceGroupsProps) {
  const blocks = readerBlocks(props.sources);
  return (
    <ul {...props.listProps} style={{ listStyle: 'none', margin: '0 0 10px', padding: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
      {blocks.map((block) =>
        block.kind === 'group' ? <GroupBlock key={`group:${block.classId}`} block={block} props={props} /> : <SourceRowSlot key={block.source.sourceId} node={props.renderRow(block.source, false)} />,
      )}
    </ul>
  );
}

/** A source alone: its row as `renderRow` gives it. */
function SourceRowSlot({ node }: { node: ReactNode }) {
  return <>{node}</>;
}
