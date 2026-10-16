// Boston OpenContext MCP Skill — Domain knowledge for querying Boston
// civic open data via the CKAN-native OpenContext MCP server.
//
// The text is `@typedstandards/civic-typed-router`'s (#599 W2): the website's
// hand-synced copy of civic-ai-tools/docs/skills/boston.md, moved into the
// package byte for byte. Change it there. Since #599 W3 it is the package's
// aliased view: every tool it names is `boston__<tool>`, and the short form
// `search/get_dataset` is kept in both views.
import { bostonSkill, civicRouter } from '@typedstandards/civic-typed-router';

export const BOSTON_OPENCONTEXT_SKILL: string = bostonSkill(civicRouter.aliasedView);
