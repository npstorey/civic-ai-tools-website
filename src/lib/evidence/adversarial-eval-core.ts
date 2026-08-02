// Adversarial evaluation — PURE core, app-side shim over
// @typedstandards/civic-typed-harness (S3a P1, #166; the verify-core shim
// pattern of #116-WS3 applied to the rubric layer).
//
// The rubric text, its Q26-pinned `RUBRIC_VERSION_SHA256`, the prompt
// builder, and the response parser live in the harness's rubric group
// (ADR-0022 §C), relocated byte-exactly — the version hash is unchanged, and
// the golden-locked BlobRef output interpolation in `buildEvaluationPrompt`
// rides through unchanged per G0-2 (preserve; cleanup is a deliberate
// post-S3a emission change). The model runner and DB/blob emission stay
// app-side in ./adversarial-eval.ts, which re-exports this module.
export {
  RUBRIC_ID,
  EVALUATION_CRITERIA,
  EVALUATION_RUBRIC,
  RUBRIC_VERSION_SHA256,
  buildEvaluationPrompt,
  parseEvaluationResponse,
  type ParsedEvaluation,
} from '@typedstandards/civic-typed-harness';
