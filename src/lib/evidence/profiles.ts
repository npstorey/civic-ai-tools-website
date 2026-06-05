// Producer Profile → captureMethod vocabulary (spec §8.6, ADR-0011).
//
// As of civic-ai-tools-website#116 WS2 the implementation lives in the
// browser-safe `verify-core/profiles.ts`. This file re-exports it so the publish
// route (publish-time validation) and the verifier (verification check #15)
// — server and the typedstandards.org browser client (WS3) — resolve the §8.6
// vocabulary from a single source.
export * from './verify-core/profiles.ts';
