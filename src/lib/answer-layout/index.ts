// The answer view's layouts (LAYOUT-WEB W4 P1). A TYPED STUB in the red commit:
// every name the tests import exists with its type, and nothing is built. The
// fix commit replaces this file.

import type { LayoutPayload } from '@typedstandards/produce-core';

export type { LayoutPayload };

const UNBUILT: LayoutPayload = {
  name: '',
  version: 0,
  appliesTo: [],
  order: [],
  disclosure: { label: '', order: [], openByDefault: false },
  steps: { placement: '', openByDefault: false },
  rendererVersion: '',
};

export const ANSWER_FIRST: LayoutPayload = UNBUILT;
export const ENVELOPE_ORDER: LayoutPayload = UNBUILT;
export const BUILT_IN_LAYOUTS: readonly LayoutPayload[] = [];

export interface InstanceLayouts {
  default: LayoutPayload;
  offered: readonly LayoutPayload[];
}

export const BUILT_IN_INSTANCE_LAYOUTS: InstanceLayouts = { default: UNBUILT, offered: [] };

export const PAGE_PARTS: ReadonlyArray<{ readonly name: string | null; readonly view: string }> = [];
export type PagePartView = string;
export const PAGE_PART_VIEWS: readonly PagePartView[] = [];
export const DISCLOSURE_SECTIONS: ReadonlyArray<{ readonly name: string | null; readonly view: string }> = [];
export type DisclosureSectionView = string;
export type RecordSectionView = string;

export interface Placement<V extends string> {
  order: V[];
  unknown: string[];
}

export function placeParts<V extends string>(
  table: ReadonlyArray<{ readonly name: string | null; readonly view: V }>,
  named: readonly string[],
): Placement<V> {
  void table;
  void named;
  return { order: [], unknown: [] };
}

export function pageOrder(layout: LayoutPayload): Placement<PagePartView> {
  void layout;
  return { order: [], unknown: [] };
}

export function disclosureOrder(layout: LayoutPayload): Placement<DisclosureSectionView> {
  void layout;
  return { order: [], unknown: [] };
}

export function unknownPartNames(layout: LayoutPayload): string[] {
  void layout;
  return [];
}

export function layoutId(layout: Pick<LayoutPayload, 'name' | 'version'>): string {
  void layout;
  return '';
}

export function parseStoredLayoutChoice(raw: string | null, offered: readonly LayoutPayload[]): string | null {
  void raw;
  void offered;
  return null;
}

export function selectLayout(layouts: InstanceLayouts, chosen: string | null): LayoutPayload {
  void chosen;
  return layouts.default;
}

export function layoutLine(layout: Pick<LayoutPayload, 'name' | 'version'>): string {
  void layout;
  return '';
}
