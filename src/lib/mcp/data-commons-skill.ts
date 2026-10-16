// Data Commons MCP Skill — Domain knowledge for querying Google Data Commons.
//
// The text is `@typedstandards/civic-typed-router`'s (#599 W2): the website's
// hand-synced copy of civic-ai-tools/docs/skills/data-commons.md, moved into
// the package byte for byte. Change it there. Since #599 W3 it is the
// package's aliased view: every tool it names is `data_commons__<tool>`.
//
// Instance-identity config (ADR-0020): skill text lands inside signed
// packages, so the host mention resolves through config — evaluated at MODULE
// LOAD, as it always was; with no identity declared the host mention is
// honestly OMITTED (#258), never defaulted. The package reads no environment,
// so the host arrives here as its input.
import { civicRouter, dataCommonsSkill } from '@typedstandards/civic-typed-router';
import { getPublicationHost } from '../site-config.ts';

/**
 * The publication host the Data Commons guidance names, read once at module
 * load. `buildSystemPrompt` (`./socrata-skill.ts`) hands the same value to the
 * package, so the composed prompt and `DATA_COMMONS_SKILL` always agree.
 */
export const DATA_COMMONS_PUBLICATION_HOST: string | null = getPublicationHost();

export const DATA_COMMONS_SKILL: string = dataCommonsSkill(DATA_COMMONS_PUBLICATION_HOST, civicRouter.aliasedView);
