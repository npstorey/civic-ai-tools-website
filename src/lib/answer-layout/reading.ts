// The reading of an instance's layout setting (LAYOUT-WEB W4 P1). A TYPED STUB
// in the red commit: it checks nothing and reads nothing. The fix commit
// replaces this file.

import type { LayoutPayload } from '@typedstandards/produce-core';
import { BUILT_IN_INSTANCE_LAYOUTS, type InstanceLayouts } from './index.ts';

export const LAYOUT_ENV = 'ANSWER_LAYOUT';
export const LAYOUT_PATH_ENV = 'ANSWER_LAYOUT_PATH';
export const LAYOUT_URL_ENV = 'ANSWER_LAYOUT_URL';

export class AnswerLayoutConfigurationError extends Error {
  readonly code = 'answer_layout_invalid';
  constructor(message: string) {
    super(message);
    this.name = 'AnswerLayoutConfigurationError';
  }
}

export function checkLayout(payload: unknown, source: string): LayoutPayload {
  void source;
  return payload as LayoutPayload;
}

export interface AnswerLayoutSetting {
  inline?: string;
  path?: string;
  url?: string;
}

export interface AnswerLayoutReading extends InstanceLayouts {
  unknownParts: string[];
}

export function resolveAnswerLayouts(
  setting: AnswerLayoutSetting,
  options: { readFile?: (path: string) => string; warn?: (line: string) => void } = {},
): AnswerLayoutReading {
  void setting;
  void options;
  return { ...BUILT_IN_INSTANCE_LAYOUTS, unknownParts: [] };
}
