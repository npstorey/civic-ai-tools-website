'use client';

/**
 * The composer's harness menu (UX-2 P3b-2; D1 = A, D3 = A, Q10 = A): one `Menu` that replaces the gear, the
 * Advanced-options region and the portal picker on the home page, `/ask` and `/explore`. It renders in the box, after
 * the arrow (`Composer`'s `harness` slot; fixes 3 and 4), as `data-part="harness-menu"`.
 *
 * THE TRIGGER reads "Default harness", then, at 900 px and up, " · " and the model's name, cut by CSS at a fixed
 * width; its accessible name carries the whole name (fix 3's check).
 *
 * THE PANEL (wide, fix 1), by the mount's `variant`:
 *   - `full` (signed in, or where no sign-in is offered on the home page and `/ask`; v2 ruling 4): the heading row,
 *     Model, Data sources, Session type (when the mount passes one), Compare (when it passes one; answer-first mounts
 *     only, Q12 = A), a rule, All settings;
 *   - `signed-out` (signed out where sign-in is offered; D2 = A amended, ASK3 = A): the heading row, Model disabled
 *     with its reason, Data sources, a rule, and "Sign in for more options", which does what P3b-1's sign-in line
 *     does, through the same decision (`useSignInAction`, fix 14);
 *   - `sources-only` (`/explore` where no sign-in is offered; v3 conflict ruling 2): the heading row and Data sources.
 *
 * DATA SOURCES words itself by the instance's routing through `canPauseToAsk`, the predicate the Settings row reads
 * (v2 ruling 1): the in-loop form only in loop with the decision store, both read; the all-sources form otherwise,
 * an unread or failed read included (the known window, v3 conflict ruling 1). Its item changes nothing in a run.
 *
 * IT HOLDS NO RUN STATE. The model, the session type and the comparison are the mount's; the menu reports choices.
 */

import { Menu, type MenuItem } from '@/components/ui/Menu';
import type { Model } from '@/lib/model-list';
import type { QueryMode } from '@/lib/query-presentation';
import { NOTEBOOK_MODE_UNAVAILABLE_REASON, type NotebookModeAffordance } from '@/lib/notebook-availability';
import { SETTINGS_HREF } from '@/lib/sources/copy';
import { canPauseToAsk, useSourceConsent } from '@/components/sources/useSourceConsent';
import { startSignIn, useSignInAction } from './SignInControl';
import {
  ALL_SETTINGS,
  COMPARE_ITEM,
  COMPARE_VALUE_OFF,
  COMPARE_VALUE_ON,
  DATA_SOURCES_ITEM,
  HARNESS_HEADING,
  HARNESS_TRIGGER,
  HARNESS_TRIGGER_SEPARATOR,
  MODEL_ITEM,
  SANDBOX_DESCRIPTION,
  SANDBOX_SIGN_IN_REASON,
  SESSION_TYPE_ITEM,
  SIGN_IN_FOR_MORE,
} from './copy';

export interface HarnessMenuProps {
  variant: 'full' | 'signed-out' | 'sources-only';
  /** The catalog's selectable models (the mount reads `/api/models`; the menu fetches nothing). */
  models: Model[];
  /** The model in use, by id. */
  model: string;
  /** A model chosen; absent, Model is not offered as a choice. */
  onModel?: (id: string) => void;
  /** Session type: the mount's mode, its setter, and how notebooks are offered here (`notebookModeAffordance`). */
  session?: { mode: QueryMode; onMode: (mode: QueryMode) => void; affordance: NotebookModeAffordance };
  /** Compare with a second harness, on answer-first mounts only (Q12 = A). */
  comparison?: { restored: boolean; onChange: (restored: boolean) => void };
  /** A run is under way: the trigger is disabled, as the gear's controls were. */
  disabled?: boolean;
}

const ID = {
  heading: 'harness-heading',
  model: 'model',
  modelPrefix: 'model:',
  sources: 'data-sources',
  sourcesAuto: 'data-sources-auto',
  sourcesPick: 'data-sources-pick',
  sourcesSettings: 'data-sources-settings',
  session: 'session-type',
  standard: 'session-standard',
  sandbox: 'session-sandbox',
  compare: 'compare',
  rule: 'rule',
  settings: 'all-settings',
  signIn: 'sign-in',
} as const;

export default function HarnessMenu({ variant, models, model, onModel, session, comparison, disabled = false }: HarnessMenuProps) {
  // The mount reads the consent (QueryForm, TraceControls); the menu only reads the routing pair it holds.
  const consent = useSourceConsent({ load: false });
  const signInAction = useSignInAction();
  const modelName = models.find((m) => m.id === model)?.name ?? '';
  const form = canPauseToAsk(consent) ? DATA_SOURCES_ITEM.inLoop : DATA_SOURCES_ITEM.allSources;

  const heading: MenuItem = { id: ID.heading, kind: 'heading', label: HARNESS_HEADING };
  const rule: MenuItem = { id: ID.rule, kind: 'rule', label: '' };
  const sources: MenuItem = {
    id: ID.sources,
    label: DATA_SOURCES_ITEM.label,
    value: DATA_SOURCES_ITEM.value,
    children: [
      { id: ID.sourcesAuto, label: form.auto, description: form.autoDescription, checked: true },
      { id: ID.sourcesPick, label: DATA_SOURCES_ITEM.pick, checked: false, disabledReason: form.pickReason },
      { id: ID.sourcesSettings, kind: 'footer', label: DATA_SOURCES_ITEM.footer, href: SETTINGS_HREF },
    ],
  };
  const modelItem: MenuItem = variant === 'signed-out'
    ? { id: ID.model, label: MODEL_ITEM.label, value: modelName, disabledReason: MODEL_ITEM.signedOutReason }
    : {
        id: ID.model,
        label: MODEL_ITEM.label,
        value: modelName,
        children: models.map((m) => ({ id: `${ID.modelPrefix}${m.id}`, label: m.name, value: m.tag, checked: m.id === model })),
      };

  const items: MenuItem[] = [heading];
  if (variant === 'sources-only') {
    items.push(sources);
  } else if (variant === 'signed-out') {
    items.push(modelItem, sources, rule, {
      id: ID.signIn,
      kind: 'button',
      label: SIGN_IN_FOR_MORE,
      ...(signInAction?.kind === 'link' ? { href: signInAction.href } : {}),
    });
  } else {
    items.push(modelItem, sources);
    if (session) {
      const sandbox = session.mode === 'notebook';
      const sandboxReason = session.affordance === 'unavailable' ? NOTEBOOK_MODE_UNAVAILABLE_REASON
        : session.affordance === 'sign-in' ? SANDBOX_SIGN_IN_REASON : undefined;
      items.push({
        id: ID.session,
        label: SESSION_TYPE_ITEM.label,
        value: sandbox ? SESSION_TYPE_ITEM.sandbox : SESSION_TYPE_ITEM.standard,
        children: [
          { id: ID.standard, label: SESSION_TYPE_ITEM.standard, checked: !sandbox },
          sandboxReason === undefined
            ? { id: ID.sandbox, label: SESSION_TYPE_ITEM.sandbox, checked: sandbox, description: SANDBOX_DESCRIPTION }
            : { id: ID.sandbox, label: SESSION_TYPE_ITEM.sandbox, checked: false, disabledReason: sandboxReason },
        ],
      });
      if (comparison) {
        items.push({
          id: ID.compare,
          label: COMPARE_ITEM.label,
          // In Sandbox, Compare is disabled (#735), and its value never reads On, whatever the stored choice says.
          value: comparison.restored && !sandbox ? COMPARE_VALUE_ON : COMPARE_VALUE_OFF,
          description: COMPARE_ITEM.description,
          ...(sandbox ? { disabledReason: COMPARE_ITEM.sandboxReason } : {}),
        });
      }
    }
    items.push(rule, { id: ID.settings, label: ALL_SETTINGS, href: SETTINGS_HREF });
  }

  const onSelect = (id: string) => {
    if (id.startsWith(ID.modelPrefix)) onModel?.(id.slice(ID.modelPrefix.length));
    else if (id === ID.standard) session?.onMode('standard');
    else if (id === ID.sandbox) session?.onMode('notebook');
    else if (id === ID.compare && comparison) comparison.onChange(!comparison.restored);
    else if (id === ID.signIn && signInAction?.kind === 'start') startSignIn(signInAction.providerId);
  };

  return (
    <div data-part="harness-menu" className="composer-harness">
      <Menu
        size="label"
        wide
        disabled={disabled}
        triggerLabel={modelName ? `${HARNESS_TRIGGER}${HARNESS_TRIGGER_SEPARATOR}${modelName}` : HARNESS_TRIGGER}
        trigger={
          <>
            {HARNESS_TRIGGER}
            {modelName ? (
              <span className="composer-harness-model">
                {HARNESS_TRIGGER_SEPARATOR}
                {modelName}
              </span>
            ) : null}
          </>
        }
        items={items}
        onSelect={onSelect}
      />
    </div>
  );
}
