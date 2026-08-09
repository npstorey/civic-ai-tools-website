# Model Audit - OpenRouter Models for Civic AI Tools

> **Historical — audit run 2026-01-15, not repeated.** (The date line below says 2025-01-15; the year is a typo — this repo's first commit is 2026-01-14, and this file entered git on 2026-03-05.) Model availability, pricing, and tool-calling reliability have turned over completely since. Retained for the evaluation criteria, not the verdicts. The live model list is defined in code (`availableModels` in [`../src/lib/mcp/tools.ts`](../src/lib/mcp/tools.ts), served via `/api/models`); the model endpoint and API key are environment-driven (`MODEL_API_BASE_URL`, `OPENROUTER_API_KEY`) — see [`deploy.md`](deploy.md#the-model-seam).

**Date:** 2025-01-15
**Purpose:** Evaluate available models for the MCP demo, considering cost, performance, and tool calling reliability.

## Requirements

For this demo, models must:
1. **Support tool/function calling** - Required for MCP integration
2. **Be cost-effective** - Demo has rate limits, but costs add up
3. **Be reasonably fast** - Users shouldn't wait too long for responses
4. **Produce quality results** - Must correctly interpret and use the `get_data` tool

---

## Available Models (Tool Calling Support)

### Premium Tier ($10+ per 1M output tokens)

| Model | ID | Input | Output | Context | Tool Support | Notes |
|-------|-----|-------|--------|---------|--------------|-------|
| Claude Opus 4 | `anthropic/claude-opus-4` | $15 | $75 | 200K | ✅ Excellent | Best for complex reasoning, expensive |
| GPT-4 Turbo | `openai/gpt-4-turbo` | $10 | $30 | 128K | ✅ Excellent | Vision capable, reliable tools |

### Mid-Range ($1-10 per 1M output tokens)

| Model | ID | Input | Output | Context | Tool Support | Notes |
|-------|-----|-------|--------|---------|--------------|-------|
| Claude Sonnet 4 | `anthropic/claude-sonnet-4` | $3 | $15 | 200K | ✅ Excellent | Best balance of quality/cost |
| GPT-4o | `openai/gpt-4o` | $2.50 | $10 | 128K | ✅ Excellent | Multimodal, very capable |
| Claude Haiku 3.5 | `anthropic/claude-3.5-haiku` | $0.80 | $4 | 200K | ✅ Good | Fast, cost-effective Claude |
| Mistral Large 2 | `mistralai/mistral-large-2411` | $2 | $6 | 128K | ✅ Good | European alternative |

### Budget Tier (<$1 per 1M output tokens)

| Model | ID | Input | Output | Context | Tool Support | Notes |
|-------|-----|-------|--------|---------|--------------|-------|
| GPT-4o Mini | `openai/gpt-4o-mini` | $0.15 | $0.60 | 128K | ✅ Excellent | Best budget option |
| Gemini 2.5 Flash | `google/gemini-2.5-flash` | $0.15 | $0.60 | 1M | ✅ Good | Fast, huge context |
| Gemini 2.0 Flash | `google/gemini-2.0-flash-001` | $0.10 | $0.40 | 1M | ✅ Good | Cheapest reliable option |
| DeepSeek Coder V2 | `deepseek/deepseek-coder-v2` | $0.27 | $1.10 | 128K | ⚠️ Variable | Good for code, tools less reliable |

### Free Tier

| Model | ID | Context | Tool Support | Notes |
|-------|-----|---------|--------------|-------|
| Gemini Flash Free | `google/gemini-flash-1.5` | 1M | ⚠️ Limited | Rate limited, tools may fail |
| DeepSeek Chat | `deepseek/deepseek-chat` | 128K | ⚠️ Variable | Reasoning good, tools inconsistent |
| Llama 3.1 8B | `meta-llama/llama-3.1-8b-instruct` | 128K | ❌ Poor | Not recommended for tool calling |

---

## Tool Calling Reliability Assessment

Based on OpenRouter documentation and community feedback:

### Tier 1 - Highly Reliable
- **OpenAI models** (GPT-4o, GPT-4o Mini) - Native function calling, very consistent
- **Anthropic models** (Claude Sonnet 4, Claude Haiku 3.5) - Excellent tool use

### Tier 2 - Generally Reliable
- **Google Gemini** (2.0/2.5 Flash) - Good tool support, occasional format issues
- **Mistral Large** - Decent tool calling

### Tier 3 - Use with Caution
- **Open source models** (Llama, DeepSeek) - Tool support varies, may need prompt engineering
- **Free tier models** - Rate limits and inconsistent behavior

---

## Cost Analysis for Demo

Assuming average query uses ~2000 input tokens and ~1000 output tokens:

| Model | Cost per Query | 100 Queries/Day | Notes |
|-------|---------------|-----------------|-------|
| GPT-4o Mini | $0.0009 | $0.09 | **Best value** |
| Gemini 2.0 Flash | $0.0006 | $0.06 | Cheapest reliable |
| Claude Haiku 3.5 | $0.0056 | $0.56 | Good Claude option |
| GPT-4o | $0.015 | $1.50 | Premium quality |
| Claude Sonnet 4 | $0.021 | $2.10 | Best reasoning |

---

## Recommendations

### For Default Model
**GPT-4o Mini** (`openai/gpt-4o-mini`)
- Reasons:
  - Excellent tool calling reliability
  - Very low cost ($0.15/$0.60 per 1M tokens)
  - Fast response times
  - Good reasoning for civic data queries

### For Premium Option
**GPT-4o** (`openai/gpt-4o`)
- Reasons:
  - Best overall quality
  - Excellent tool calling
  - Worth the cost for complex queries

### For Anthropic Users
**Claude Sonnet 4** (`anthropic/claude-sonnet-4`)
- Reasons:
  - Excellent reasoning and analysis
  - Strong tool calling support
  - Good for users familiar with Claude

### For Speed/Cost Optimization
**Gemini 2.0 Flash** (`google/gemini-2.0-flash-001`)
- Reasons:
  - Fastest response times
  - Lowest cost ($0.10/$0.40)
  - 1M token context (overkill for this use case, but nice)
  - Good tool support

---

## Final Selection

| Model | ID | Why Included |
|-------|-----|--------------|
| GPT-4o Mini | `openai/gpt-4o-mini` | Default - best value, reliable |
| GPT-4o | `openai/gpt-4o` | Premium quality option |
| Claude Sonnet 4 | `anthropic/claude-sonnet-4` | Best reasoning, Anthropic option |
| Gemini 2.0 Flash | `google/gemini-2.0-flash-001` | Fastest, cheapest |

### Models NOT Included

| Model | Why Excluded |
|-------|--------------|
| Llama 3.1 70B | Inconsistent tool calling with open source models |
| DeepSeek models | Tool support unreliable for production demo |
| Claude Opus 4 | Too expensive for demo ($75/1M output) |
| Free tier models | Rate limits and reliability issues |

---

## Sources

- [OpenRouter Models](https://openrouter.ai/models?supported_parameters=tools)
- [OpenRouter Tool Calling Docs](https://openrouter.ai/docs/guides/features/tool-calling)
- [Top AI Models on OpenRouter 2025](https://www.teamday.ai/blog/top-ai-models-openrouter-2025)
- [OpenRouter Pricing](https://openrouter.ai/pricing)
