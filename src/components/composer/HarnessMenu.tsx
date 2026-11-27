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
 * (v2 ruling 1): the in-loop form only in loop with the decision store, both read; the all-sources form where the read
 * says all-sources, or in loop with no store. While the routing pair is unread, or its read failed, the Auto option
 * claims no routing: its label is the item's own value, "Auto", with no description (UX-2 P6 + P10, PQ6 = (b), the
 * owner's ruling OA-917; R2's rule applied to Auto). This closes the known window of v3 conflict ruling 1.
 *
 * "ONLY THE ONES I PICK" (S3-B W1, npstorey/civic-ai-tools#318; the owner's W0 rulings D5 = A, D8 = B, D9 = A; the
 * ORCH's R2, R6 and A5 as the owner ruled it). On a mount that offers picking (`picking`, the home page and `/ask`):
 *   - in loop with the decision store, both read: enabled, S1 under it; choosing it closes the menu and opens the
 *     picker, also when it is already chosen; while it is chosen the item's value reads S13 ("{n} picked");
 *   - a read that says otherwise (all-sources, or no store): disabled with D8's reason;
 *   - while the routing pair is unread, or its read failed: disabled, with no reason (R2): no sentence about
 *     picking shows until the read says which form is true. A reader who chose it before a read failed keeps it
 *     (FIX-1 D1 = B, website #798; `picksInForce`): it stays checked, and the value still reads S13;
 *   - in loop with the store while the flows statement is unread, or `/api/flows` answered non-OK (S3-B F, the cold
 *     read's F3): disabled, with no reason, as R2. The picker lists the statement's sources and words a hit by it, so
 *     it never opens over an empty list or calls a source this site has set up "Not set up on this site.".
 * A mount that does not offer picking (`/explore`) leaves the item out (A5 = hide): its Data sources lists Auto and
 * the Settings link.
 *
 * OUTPUT FORMAT (OF2, Sprint OF-1, website #810; G0-1 = A, G0-2 = A; S9's choice b, ruled A at G0b, seat 7168515476): directly after
 * Data sources, in the `full` variant only, and only on a mount that passes `outputFormat`, which the query form does
 * on the answer-first mount (`/ask`) of an instance with `SITE_OUTPUT_FORMAT` on (`OutputFormatProvider`). OF3b fold 7
 * (the owner's D+C, OA-1283; the seat's 7225696434) took it out of the `signed-out` variant on every mount, moving
 * G0b's S9 choice b for that variant, and out of the home page's mount. It
 * reads the chosen format's name, or "Auto"; its options are Auto and each format the instance offers (none but Auto
 * in OF2, G0-9 = A). The mount owns the choice (`QueryForm`, per browser session); the menu reports it, as Session
 * type's. With the prop absent, the menu is byte for byte what it was before the item existed.
 *
 * IT HOLDS NO RUN STATE. The model, the session type and the comparison are the mount's; the menu reports choices.
 */

import { Menu, type MenuItem } from '@/components/ui/Menu';
import type { Model } from '@/lib/model-list';
import type { QueryMode } from '@/lib/query-presentation';
import { NOTEBOOK_MODE_UNAVAILABLE_REASON, type NotebookModeAffordance } from '@/lib/notebook-availability';
import { SETTINGS_HREF } from '@/lib/sources/copy';
import { canPauseToAsk, useSourceConsent, type ConsentSnapshot } from '@/components/sources/useSourceConsent';
import { startSignIn, useSignInAction } from './SignInControl';
import { chooseAuto, choosePicking, usePicks } from './picks/store';
import { isMapChoice, outputFormatInForce, storedOutputFormatValue, type OfferedOutputFormat, type OutputFormatRef } from '@/lib/output-format/registry';
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
  OUTPUT_FORMAT_ITEM,
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
  /** S3-B W1: this mount offers "Only the ones I pick" (the picker is its own, `QueryForm`); absent, the item is left out. */
  picking?: boolean;
  /**
   * OF2: the formats this instance offers, the mount's choice (null: Auto) and its setter. Absent (the setting off, or a
   * mount that owns no format, such as `/explore`'s), the item is left out.
   */
  outputFormat?: { formats: readonly OfferedOutputFormat[]; chosen: OutputFormatRef | null; onChoose: (choice: OutputFormatRef | null) => void };
}

/**
 * Whether the reader's picks are in force (FIX-1, D1 = B, website #798): the mount offers picking, the reader chose
 * "Only the ones I pick", and the routing read either says in loop with the store (`canPauseToAsk`) or has finished
 * without naming a form (a failed or unknown read, `loaded` with `routing` or `store` still `null`). Picks narrow a run
 * and never widen it (`src/lib/sources/picks.ts`), so after a failed read the picks stay shown and are sent; a read that
 * names all-sources, or in loop with no store, ends them, as before (D5 = A, D8 = B). One predicate for this menu's
 * value and the form's picks line and send (`QueryForm`), so the two cannot part.
 */
export function picksInForce(mode: 'auto' | 'pick', consent: Pick<ConsentSnapshot, 'loaded' | 'routing' | 'store'>): boolean {
  if (mode !== 'pick') return false;
  return canPauseToAsk(consent) || (consent.loaded && !pickingNotOffered(consent));
}

/** The read names a form in which "Only the ones I pick" is not offered: all-sources, or in loop with no store (D8 = B). */
function pickingNotOffered(consent: Pick<ConsentSnapshot, 'routing' | 'store'>): boolean {
  return consent.routing === 'all-sources' || (consent.routing === 'in-loop' && consent.store === false);
}

const ID = {
  heading: 'harness-heading',
  model: 'model',
  modelPrefix: 'model:',
  sources: 'data-sources',
  sourcesAuto: 'data-sources-auto',
  sourcesPick: 'data-sources-pick',
  sourcesSettings: 'data-sources-settings',
  outputFormat: 'output-format',
  outputFormatAuto: 'output-format-auto',
  outputFormatPrefix: 'output-format:',
  session: 'session-type',
  standard: 'session-standard',
  sandbox: 'session-sandbox',
  compare: 'compare',
  rule: 'rule',
  settings: 'all-settings',
  signIn: 'sign-in',
} as const;

export default function HarnessMenu({ variant, models, model, onModel, session, comparison, disabled = false, picking = false, outputFormat }: HarnessMenuProps) {
  // The mount reads the consent (QueryForm, TraceControls); the menu only reads the routing pair it holds.
  const consent = useSourceConsent({ load: false });
  const signInAction = useSignInAction();
  const modelName = models.find((m) => m.id === model)?.name ?? '';
  const inLoopForm = canPauseToAsk(consent);
  const form = inLoopForm ? DATA_SOURCES_ITEM.inLoop : DATA_SOURCES_ITEM.allSources;
  const picks = usePicks();
  // The read says which form is true only when it names all-sources, or in loop with no store (R2).
  const notOffered = pickingNotOffered(consent);
  // PQ6 = (b): a form is known only once the read names one; until then Auto states no routing.
  const formKnown = inLoopForm || notOffered;
  // FIX-1 D1 = B (#798): after a read that failed, the reader's choice stays chosen, and the value keeps counting the picks.
  const pickChosen = picking && picksInForce(picks.mode, consent);
  // The picker reads the flows statement (S3-B F, F3): until it is read, the option is not offered, and says nothing.
  const statementRead = consent.statement !== null;
  const pickItem: MenuItem | null = !picking
    ? null
    : inLoopForm && statementRead
      ? { id: ID.sourcesPick, label: DATA_SOURCES_ITEM.pick, checked: pickChosen, description: DATA_SOURCES_ITEM.inLoop.pickDescription }
      : inLoopForm
        ? { id: ID.sourcesPick, label: DATA_SOURCES_ITEM.pick, checked: pickChosen, disabled: true }
        : notOffered
          ? { id: ID.sourcesPick, label: DATA_SOURCES_ITEM.pick, checked: false, disabledReason: DATA_SOURCES_ITEM.allSources.pickReason }
          : { id: ID.sourcesPick, label: DATA_SOURCES_ITEM.pick, checked: pickChosen, disabled: true };

  const heading: MenuItem = { id: ID.heading, kind: 'heading', label: HARNESS_HEADING };
  const rule: MenuItem = { id: ID.rule, kind: 'rule', label: '' };
  const sources: MenuItem = {
    id: ID.sources,
    label: DATA_SOURCES_ITEM.label,
    value: pickChosen ? DATA_SOURCES_ITEM.picked(picks.picked.length) : DATA_SOURCES_ITEM.value,
    children: [
      formKnown
        ? { id: ID.sourcesAuto, label: form.auto, description: form.autoDescription, checked: !pickChosen }
        : { id: ID.sourcesAuto, label: DATA_SOURCES_ITEM.value, checked: !pickChosen },
      ...(pickItem ? [pickItem] : []),
      { id: ID.sourcesSettings, kind: 'footer', label: DATA_SOURCES_ITEM.footer, href: SETTINGS_HREF },
    ],
  };
  // OF2: the Output format item, after Data sources, where the mount passes one and never in `sources-only`.
  const sandbox = session?.mode === 'notebook';
  const storedFormat = outputFormat?.chosen
    ? outputFormat.formats.find((f) => f.id === outputFormat.chosen!.id && f.version === outputFormat.chosen!.version) ?? null
    : null;
  // OF3b (K3 = A): in a Sandbox session a map format is not in force; the item reads Auto, and the stored choice comes
  // back when Session type is Standard again, as Compare's does.
  const chosenFormat = outputFormatInForce(storedFormat, sandbox);
  // OF3b (C3 = A): while a map format is in force, Compare is off with its reason; its stored value comes back on Auto.
  const mapChosen = isMapChoice(chosenFormat);
  const formatItem: MenuItem | null = outputFormat && variant === 'full'
    ? {
        id: ID.outputFormat,
        label: OUTPUT_FORMAT_ITEM.label,
        value: chosenFormat ? chosenFormat.label : OUTPUT_FORMAT_ITEM.value,
        children: [
          { id: ID.outputFormatAuto, label: OUTPUT_FORMAT_ITEM.auto, description: OUTPUT_FORMAT_ITEM.autoDescription, checked: chosenFormat === null },
          ...outputFormat.formats.map((f): MenuItem => (sandbox && f.kind === 'map'
            ? { id: `${ID.outputFormatPrefix}${storedOutputFormatValue(f)}`, label: f.label, checked: false, disabledReason: OUTPUT_FORMAT_ITEM.sandboxMapReason }
            : {
                id: `${ID.outputFormatPrefix}${storedOutputFormatValue(f)}`,
                label: f.label,
                ...(f.description !== undefined || f.capLine !== undefined
                  ? {
                      // OF3b (C4's note): the cap is stated where the format is described, as a second line.
                      description: f.capLine === undefined ? f.description : (
                        <>
                          {f.description}
                          {f.description !== undefined ? ' ' : null}
                          <span data-part="format-cap-line" style={{ display: 'block' }}>{f.capLine}</span>
                        </>
                      ),
                    }
                  : {}),
                checked: chosenFormat !== null && chosenFormat.id === f.id && chosenFormat.version === f.version,
              })),
        ],
      }
    : null;
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
    // Fold 7 (D): no Output format item in the signed-out variant.
    items.push(modelItem, sources, rule, {
      id: ID.signIn,
      kind: 'button',
      label: SIGN_IN_FOR_MORE,
      ...(signInAction?.kind === 'link' ? { href: signInAction.href } : {}),
    });
  } else {
    items.push(modelItem, sources, ...(formatItem ? [formatItem] : []));
    if (session) {
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
          // In Sandbox, Compare is disabled (#735), and its value never reads On, whatever the stored choice says. So
          // while a map format is chosen (OF3b, C3 = A): its stored value stays, and comes back when Auto is chosen.
          value: comparison.restored && !sandbox && !mapChosen ? COMPARE_VALUE_ON : COMPARE_VALUE_OFF,
          description: COMPARE_ITEM.description,
          ...(sandbox ? { disabledReason: COMPARE_ITEM.sandboxReason } : mapChosen ? { disabledReason: COMPARE_ITEM.mapReason } : {}),
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
    else if (id === ID.sourcesAuto) chooseAuto();
    else if (id === ID.sourcesPick && picking && inLoopForm && statementRead) choosePicking();
    else if (id === ID.outputFormatAuto) outputFormat?.onChoose(null);
    else if (id.startsWith(ID.outputFormatPrefix)) {
      const value = id.slice(ID.outputFormatPrefix.length);
      const format = outputFormat?.formats.find((f) => storedOutputFormatValue(f) === value);
      if (format) outputFormat?.onChoose({ id: format.id, version: format.version });
    }
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
            {/* The separator stays in an inline span, so its leading space is kept; only the model's name is the cut
                inline-block (fix round 1, #729 6882289225: an inline-block that opened with the separator dropped it). */}
            {modelName ? (
              <span className="composer-harness-model">
                {HARNESS_TRIGGER_SEPARATOR}
                <span className="composer-harness-model-name">{modelName}</span>
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
