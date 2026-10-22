"""Model database for current and deprecated LLM models."""

from dataclasses import dataclass
from datetime import date
from typing import Optional
import re


@dataclass
class ModelInfo:
    """Information about an LLM model."""

    name: str
    status: str  # "current" | "deprecated" | "outdated"
    provider: str
    deprecated_date: Optional[date] = None
    replacement: Optional[str] = None
    alternative: Optional[str] = None  # Alternative replacement for specific use cases
    # Extended attributes for better recommendations
    tier: Optional[str] = None  # "flagship" | "balanced" | "fast" | "budget"
    capabilities: Optional[list[str]] = (
        None  # ["text", "vision", "audio", "extended-thinking"]
    )
    context_window: Optional[int] = None  # Token context window size
    use_case: Optional[str] = None  # Brief description of ideal use case
    cost_tier: Optional[str] = None  # "high" | "medium" | "low"
    warn_only: bool = False  # If True, warn but don't block
    newer_version: Optional[str] = None  # If set, a newer version exists (migration hint)


# Current competitive models (as of May 2026)
# Criterion: still the best choice in its tier — not just "still responding"
# Model roster refreshed 2026-09-29. current = newest competitive generation in its price/use
# tier; outdated = still served but superseded in tier (replacement = same-tier successor);
# deprecated = retirement announced by the provider. Sources checked 2026-09-29:
#   Anthropic: claude-api skill model table and Models API reference
#   OpenAI: https://platform.openai.com/docs/models, https://platform.openai.com/docs/deprecations
#   Google: https://ai.google.dev/gemini-api/docs/models, https://ai.google.dev/gemini-api/docs/deprecations
#   Alibaba: https://www.alibabacloud.com/help/en/model-studio/text-generation-model
#   DeepSeek: https://api-docs.deepseek.com/quick_start/pricing
#   Moonshot: https://platform.moonshot.ai/docs/pricing/chat
#   Zhipu: https://docs.z.ai/guides/overview/pricing
#   Upstage: https://console.upstage.ai/docs/models
#   LG: https://huggingface.co/api/models?author=LGAI-EXAONE
#   Kakao: https://huggingface.co/api/models?author=kakaocorp (no change)
CURRENT_MODELS = {
    # ── OpenAI GPT-4.1 series (released Apr 2025, 1M context) ────────────
    # ── OpenAI GPT-5.4 series ─────────────────────────────────────────────
    # ── OpenAI GPT-5.5 series (released Apr-May 2026) ─────────────────────
    # ── Anthropic Claude 4 series ─────────────────────────────────────────
    # ── Updated 2026-09-01 ───────────────────────────────────
    # The checker's value depends on database freshness. A stale database fails
    # twice: it calls new models unknown while measuring nothing and returning
    # green, then calls displaced models current and recommends obsolete choices.
    'claude-opus-5': ModelInfo(
        'claude-opus-5',
        'current',
        'Anthropic',
        tier='flagship',
        use_case='Claude Opus 5 flagship',
        cost_tier='high',
    ),
    "qwen3.8-flash-next": ModelInfo(
        "qwen3.8-flash-next", "current", "Alibaba", tier="fast"
    ),
    "glm-5.3-flash": ModelInfo(
        "glm-5.3-flash", "current", "Zhipu", tier="fast"
    ),
    # Undated aliases. These are used more often in practice but were omitted,
    # producing `known=False` and the **same treatment as an invented name**.
    # The checker then measured nothing while returning green. `claude-haiku-4-5`
    # already existed in this form; the other aliases were simply missing.
    # ── Google Gemini 3.x series ────────────────────────────────
    # Current as of 2026-09-01.
    'gemini-3.1-pro': ModelInfo(
        'gemini-3.1-pro',
        'current',
        'Google',
        tier='balanced',
        capabilities=['text', 'vision', 'audio', 'video', 'thinking'],
        context_window=1000000,
        use_case='Gemini 3.1 Pro GA — graduated from preview (Feb 2026)',
        cost_tier='high',
        newer_version='gemini-3.8-flash',
    ),
    'gemini-3.1-flash': ModelInfo(
        'gemini-3.1-flash',
        'current',
        'Google',
        tier='balanced',
        capabilities=['text', 'vision', 'audio', 'thinking'],
        context_window=1000000,
        use_case='Gemini 3.1 Flash — cost-effective alternative to gemini-3.5-flash (~3x cheaper)',
        cost_tier='medium',
        newer_version='gemini-3.8-flash',
    ),
    # ── Alibaba Qwen ──────────────────────────────────────────────────────
    # Branded API models
    "qwen-max": ModelInfo(
        "qwen-max",
        "current",
        "Alibaba",
        tier="flagship",
        capabilities=["text", "reasoning"],
        context_window=32768,
        use_case="Highest-capability Qwen model via Alibaba Cloud API",
        cost_tier="high",
    ),
    "qwen-plus": ModelInfo(
        "qwen-plus",
        "current",
        "Alibaba",
        tier="balanced",
        capabilities=["text", "reasoning"],
        context_window=1000000,
        use_case="Balanced quality and cost with 1M token context",
        cost_tier="medium",
    ),
    "qwen-flash": ModelInfo(
        "qwen-flash",
        "current",
        "Alibaba",
        tier="fast",
        capabilities=["text"],
        context_window=1000000,
        use_case="Fast, cost-effective Qwen; replacement for qwen-turbo",
        cost_tier="low",
    ),
    # Qwen3 open and API models
    "qwen3": ModelInfo("qwen3", "current", "Alibaba"),
    # Qwen3.6 series (Apr 2026) — latest on HuggingFace open-weight
    "qwen3.6": ModelInfo(
        "qwen3.6",
        "current",
        "Alibaba",
        tier="balanced",
        capabilities=["text", "reasoning"],
        context_window=1000000,
        use_case="Qwen 3.6 open-weight flagship — latest available on HuggingFace (Apr 2026)",
        cost_tier="medium",
    ),
    # Qwen3.7 series (May 2026) — latest on hosted API
    # ── DeepSeek V4 series (released Apr 2026) ────────────────────────────
    "deepseek-v4-pro": ModelInfo(
        "deepseek-v4-pro",
        "current",
        "DeepSeek",
        tier="flagship",
        capabilities=["text", "code", "reasoning"],
        context_window=1000000,
        use_case="DeepSeek V4 flagship MoE (1.6T/49B active, Apr 2026)",
        cost_tier="low",
    ),
    # ── Moonshot Kimi ─────────────────────────────────────────────────────
    # ── Zhipu GLM ─────────────────────────────────────────────────────────
    # ── Korean models ─────────────────────────────────────────────────────
    # Upstage Solar
    "solar-open-100b": ModelInfo("solar-open-100b", "current", "Upstage"),
    # LG EXAONE
    # Kakao Kanana
    "kanana-2-30b-a3b-instruct": ModelInfo(
        "kanana-2-30b-a3b-instruct",
        "current",
        "Kakao",
        tier="balanced",
        capabilities=["text"],
        context_window=32768,
        use_case="Kakao's latest agentic model with multi-turn tool-calling",
        cost_tier="low",
    ),
    # ── Tier refresh 2026-09-29 (provider documentation; see sources above) ──
    'claude-opus-5-5': ModelInfo(
        'claude-opus-5-5',
        'current',
        'Anthropic',
        tier='flagship',
        use_case='Claude Opus 5.5 flagship (Sep 2026)',
        cost_tier='high',
    ),
    'claude-fable-5-1': ModelInfo(
        'claude-fable-5-1',
        'current',
        'Anthropic',
        tier='flagship',
        use_case='Claude Fable 5.1, most capable widely released Claude',
        cost_tier='high',
    ),
    'claude-sonnet-5': ModelInfo(
        'claude-sonnet-5',
        'current',
        'Anthropic',
        tier='balanced',
        use_case='Claude Sonnet 5 balanced tier',
        cost_tier='medium',
    ),
    'claude-haiku-4-5': ModelInfo(
        'claude-haiku-4-5',
        'current',
        'Anthropic',
        tier='fast',
        use_case='Claude Haiku 4.5 small tier',
        cost_tier='low',
    ),
    'claude-haiku-4-5-20251001': ModelInfo(
        'claude-haiku-4-5-20251001',
        'current',
        'Anthropic',
        tier='fast',
        use_case='Claude Haiku 4.5 small tier (dated id)',
        cost_tier='low',
    ),
    'gpt-6-astra': ModelInfo(
        'gpt-6-astra',
        'current',
        'OpenAI',
        tier='flagship',
        use_case='GPT-6 Astra flagship for complex reasoning and coding',
        cost_tier='high',
    ),
    'gpt-6-sol': ModelInfo(
        'gpt-6-sol',
        'current',
        'OpenAI',
        tier='balanced',
        use_case='GPT-6 Sol balances intelligence and cost',
        cost_tier='medium',
    ),
    'gpt-6-luna': ModelInfo(
        'gpt-6-luna',
        'current',
        'OpenAI',
        tier='budget',
        use_case='GPT-6 Luna for cost-sensitive, high-volume work',
        cost_tier='low',
    ),
    'gemini-3.8-flash': ModelInfo(
        'gemini-3.8-flash',
        'current',
        'Google',
        tier='flagship',
        use_case='Gemini 3.8 Flash, most intelligent Flash (Sep 2026)',
        cost_tier='medium',
    ),
    'gemini-3.5-flash-lite': ModelInfo(
        'gemini-3.5-flash-lite',
        'current',
        'Google',
        tier='budget',
        use_case='Gemini 3.5 Flash-Lite',
        cost_tier='low',
    ),
    'gemini-3.1-pro-preview': ModelInfo(
        'gemini-3.1-pro-preview',
        'current',
        'Google',
        tier='flagship',
        use_case='Gemini 3.1 Pro preview; no shutdown date announced',
        cost_tier='high',
    ),
    'gemini-3.1-flash-image': ModelInfo(
        'gemini-3.1-flash-image',
        'current',
        'Google',
        use_case='Nano Banana 2 image generation',
    ),
    'qwen3.8-max': ModelInfo(
        'qwen3.8-max',
        'current',
        'Alibaba',
        tier='flagship',
        use_case='Qwen 3.8 Max, strongest reasoning',
        cost_tier='high',
    ),
    'qwen3.7-plus': ModelInfo(
        'qwen3.7-plus',
        'current',
        'Alibaba',
        tier='balanced',
        use_case='Qwen 3.7 Plus, balanced performance and cost',
        cost_tier='medium',
    ),
    'qwen3.8-flash': ModelInfo(
        'qwen3.8-flash',
        'current',
        'Alibaba',
        tier='fast',
        use_case='Qwen 3.8 Flash, low cost',
        cost_tier='low',
    ),
    'deepseek-flash': ModelInfo(
        'deepseek-flash',
        'current',
        'DeepSeek',
        tier='fast',
        use_case='DeepSeek V4.1 Flash',
        cost_tier='low',
    ),
    'kimi-k3': ModelInfo(
        'kimi-k3',
        'current',
        'Moonshot',
        tier='flagship',
        use_case='Kimi K3 flagship',
        cost_tier='high',
    ),
    'kimi-k2.6': ModelInfo(
        'kimi-k2.6',
        'current',
        'Moonshot',
        tier='balanced',
        use_case='Kimi K2.6',
        cost_tier='medium',
    ),
    'kimi-k2.7-code': ModelInfo(
        'kimi-k2.7-code',
        'current',
        'Moonshot',
        tier='balanced',
        use_case='Kimi K2.7 Code for coding',
        cost_tier='medium',
    ),
    'glm-5.3': ModelInfo(
        'glm-5.3',
        'current',
        'Zhipu',
        tier='flagship',
        use_case='GLM-5.3 latest flagship',
        cost_tier='medium',
    ),
    'solar-pro4': ModelInfo(
        'solar-pro4',
        'current',
        'Upstage',
        tier='flagship',
        use_case='Solar Pro 4 flagship for agentic use',
        cost_tier='medium',
    ),
    'k-exaone-2.0-750b-a37b': ModelInfo(
        'k-exaone-2.0-750b-a37b',
        'current',
        'LG',
        tier='flagship',
        use_case='K-EXAONE 2.0 (Jul 2026)',
        cost_tier='high',
    ),
    'exaone-4.5-33b': ModelInfo(
        'exaone-4.5-33b',
        'current',
        'LG',
        tier='balanced',
        use_case='EXAONE 4.5 33B (Apr 2026)',
        cost_tier='medium',
    ),
}

# Deprecated models with replacements
DEPRECATED_MODELS = {
    # ── OpenAI o-series outdated (superseded by gpt-5.5 series) ──────────
    'o3': ModelInfo(
        'o3',
        'deprecated',
        'OpenAI',
        deprecated_date=date(2026, 12, 11),
        replacement='gpt-6-astra',
    ),
    'o3-mini': ModelInfo(
        'o3-mini',
        'deprecated',
        'OpenAI',
        deprecated_date=date(2026, 10, 23),
        replacement='gpt-6-sol',
    ),
    'o3-pro': ModelInfo(
        'o3-pro',
        'deprecated',
        'OpenAI',
        deprecated_date=date(2026, 12, 11),
        replacement='gpt-6-astra',
    ),
    'o4-mini': ModelInfo(
        'o4-mini',
        'deprecated',
        'OpenAI',
        deprecated_date=date(2026, 10, 23),
        replacement='gpt-6-sol',
    ),
    # ── OpenAI GPT-5.3 outdated (superseded by gpt-5.5 series) ───────────
    'gpt-5.3-codex': ModelInfo(
        'gpt-5.3-codex',
        'outdated',
        'OpenAI',
        replacement='gpt-6-astra',
    ),
    # ── OpenAI GPT-5 outdated (superseded by gpt-5.4 series) ─────────────
    'gpt-5': ModelInfo(
        'gpt-5',
        'deprecated',
        'OpenAI',
        deprecated_date=date(2026, 12, 11),
        replacement='gpt-6-astra',
    ),
    'gpt-5-mini': ModelInfo(
        'gpt-5-mini',
        'deprecated',
        'OpenAI',
        deprecated_date=date(2026, 12, 11),
        replacement='gpt-6-sol',
    ),
    'gpt-5.1': ModelInfo(
        'gpt-5.1',
        'outdated',
        'OpenAI',
        replacement='gpt-6-astra',
    ),
    'gpt-5.2': ModelInfo(
        'gpt-5.2',
        'outdated',
        'OpenAI',
        replacement='gpt-6-astra',
    ),
    'gpt-5.3': ModelInfo(
        'gpt-5.3',
        'outdated',
        'OpenAI',
        replacement='gpt-6-astra',
    ),
    # ── OpenAI deprecated ─────────────────────────────────────────────────
    'gpt-3.5-turbo': ModelInfo(
        'gpt-3.5-turbo',
        'deprecated',
        'OpenAI',
        deprecated_date=date(2025, 1, 1),
        replacement='gpt-6-luna',
    ),
    'gpt-4': ModelInfo(
        'gpt-4',
        'deprecated',
        'OpenAI',
        deprecated_date=date(2026, 10, 23),
        replacement='gpt-6-astra',
    ),
    'gpt-4-turbo': ModelInfo(
        'gpt-4-turbo',
        'deprecated',
        'OpenAI',
        deprecated_date=date(2025, 6, 1),
        replacement='gpt-6-sol',
    ),
    # gpt-4o family: still in API but not competitive vs gpt-4.1 (better + cheaper)
    'gpt-4o': ModelInfo(
        'gpt-4o',
        'outdated',
        'OpenAI',
        replacement='gpt-6-sol',
    ),
    'gpt-4o-mini': ModelInfo(
        'gpt-4o-mini',
        'outdated',
        'OpenAI',
        replacement='gpt-6-luna',
    ),
    # o1 series: superseded
    'o1': ModelInfo(
        'o1',
        'deprecated',
        'OpenAI',
        deprecated_date=date(2026, 10, 23),
        replacement='gpt-6-astra',
        alternative='gpt-5.5-instant (if speed-sensitive)',
    ),
    'o1-mini': ModelInfo(
        'o1-mini',
        'deprecated',
        'OpenAI',
        deprecated_date=date(2025, 4, 28),
        replacement='gpt-6-sol',
    ),
    'o1-pro': ModelInfo(
        'o1-pro',
        'deprecated',
        'OpenAI',
        deprecated_date=date(2026, 10, 23),
        replacement='gpt-6-astra',
    ),
    'o1-preview': ModelInfo(
        'o1-preview',
        'deprecated',
        'OpenAI',
        deprecated_date=date(2025, 4, 28),
        replacement='gpt-6-astra',
    ),
    # ── Anthropic outdated ────────────────────────────────────────────────
    # ── Claude 4.x boundary: only 4.7 and 4.8 remain current; 4.6 and older retire.
    # Send tiers without a direct successor (Sonnet and Haiku) to 4-7. Leaving
    # the replacement empty tells users a model is stale without showing where to move.
    'claude-sonnet-4-6': ModelInfo(
        'claude-sonnet-4-6',
        'outdated',
        'Anthropic',
        replacement='claude-sonnet-5',
    ),
    'claude-sonnet-4-5': ModelInfo(
        'claude-sonnet-4-5',
        'outdated',
        'Anthropic',
        replacement='claude-sonnet-5',
    ),
    'claude-sonnet-4-5-20250929': ModelInfo(
        'claude-sonnet-4-5-20250929',
        'outdated',
        'Anthropic',
        replacement='claude-sonnet-5',
    ),
    'claude-opus-4-5': ModelInfo(
        'claude-opus-4-5',
        'outdated',
        'Anthropic',
        replacement='claude-opus-5',
    ),
    'claude-opus-4-6': ModelInfo(
        'claude-opus-4-6',
        'outdated',
        'Anthropic',
        replacement='claude-opus-5',
    ),
    # ── Anthropic deprecated ──────────────────────────────────────────────
    'claude-opus-4': ModelInfo(
        'claude-opus-4',
        'deprecated',
        'Anthropic',
        deprecated_date=date(2026, 4, 20),
        replacement='claude-opus-5',
    ),
    'claude-sonnet-4': ModelInfo(
        'claude-sonnet-4',
        'deprecated',
        'Anthropic',
        deprecated_date=date(2026, 4, 20),
        replacement='claude-sonnet-5',
    ),
    'claude-2': ModelInfo(
        'claude-2',
        'deprecated',
        'Anthropic',
        deprecated_date=date(2024, 6, 1),
        replacement='claude-sonnet-5',
    ),
    'claude-2.1': ModelInfo(
        'claude-2.1',
        'deprecated',
        'Anthropic',
        deprecated_date=date(2024, 6, 1),
        replacement='claude-sonnet-5',
    ),
    'claude-3-opus': ModelInfo(
        'claude-3-opus',
        'deprecated',
        'Anthropic',
        deprecated_date=date(2025, 7, 21),
        replacement='claude-opus-5',
    ),
    'claude-3-opus-20240229': ModelInfo(
        'claude-3-opus-20240229',
        'deprecated',
        'Anthropic',
        deprecated_date=date(2025, 7, 21),
        replacement='claude-opus-5',
    ),
    'claude-3-sonnet': ModelInfo(
        'claude-3-sonnet',
        'deprecated',
        'Anthropic',
        deprecated_date=date(2025, 3, 1),
        replacement='claude-sonnet-5',
    ),
    "claude-3-haiku": ModelInfo(
        "claude-3-haiku",
        "deprecated",
        "Anthropic",
        deprecated_date=date(2026, 2, 19),
        replacement="claude-haiku-4-5",
    ),
    "claude-3-haiku-20240307": ModelInfo(
        "claude-3-haiku-20240307",
        "deprecated",
        "Anthropic",
        deprecated_date=date(2026, 2, 19),
        replacement="claude-haiku-4-5-20251001",
    ),
    'claude-3.5-sonnet': ModelInfo(
        'claude-3.5-sonnet',
        'deprecated',
        'Anthropic',
        deprecated_date=date(2025, 10, 28),
        replacement='claude-sonnet-5',
    ),
    'claude-sonnet-3.5': ModelInfo(
        'claude-sonnet-3.5',
        'deprecated',
        'Anthropic',
        deprecated_date=date(2025, 10, 28),
        replacement='claude-sonnet-5',
    ),
    'claude-3-5-sonnet-20240620': ModelInfo(
        'claude-3-5-sonnet-20240620',
        'deprecated',
        'Anthropic',
        deprecated_date=date(2025, 10, 28),
        replacement='claude-sonnet-5',
    ),
    'claude-3-5-sonnet-20241022': ModelInfo(
        'claude-3-5-sonnet-20241022',
        'deprecated',
        'Anthropic',
        deprecated_date=date(2025, 10, 28),
        replacement='claude-sonnet-5',
    ),
    "claude-3-5-haiku-20241022": ModelInfo(
        "claude-3-5-haiku-20241022",
        "deprecated",
        "Anthropic",
        deprecated_date=date(2026, 2, 19),
        replacement="claude-haiku-4-5-20251001",
    ),
    'claude-3-7-sonnet-20250219': ModelInfo(
        'claude-3-7-sonnet-20250219',
        'deprecated',
        'Anthropic',
        deprecated_date=date(2025, 10, 28),
        replacement='claude-sonnet-5',
    ),
    # ── Google preview IDs graduated to GA (old IDs deprecated) ──────────
    'gemini-3.1-flash-lite-preview': ModelInfo(
        'gemini-3.1-flash-lite-preview',
        'deprecated',
        'Google',
        replacement='gemini-3.5-flash-lite',
    ),
    # ── Google deprecated ─────────────────────────────────────────────────
    'gemini-1.0-pro': ModelInfo(
        'gemini-1.0-pro',
        'deprecated',
        'Google',
        deprecated_date=date(2025, 2, 15),
        replacement='gemini-3.5-flash-lite',
    ),
    "gemini-1.5-pro": ModelInfo(
        "gemini-1.5-pro",
        "deprecated",
        "Google",
        deprecated_date=date(2025, 9, 24),
        replacement="gemini-3.1-pro",
    ),
    'gemini-1.5-flash': ModelInfo(
        'gemini-1.5-flash',
        'deprecated',
        'Google',
        deprecated_date=date(2025, 9, 24),
        replacement='gemini-3.8-flash',
    ),
    'gemini-2.0-flash-exp': ModelInfo(
        'gemini-2.0-flash-exp',
        'deprecated',
        'Google',
        deprecated_date=date(2025, 12, 31),
        replacement='gemini-3.5-flash-lite',
    ),
    "gemini-2.0-pro": ModelInfo(
        "gemini-2.0-pro",
        "deprecated",
        "Google",
        deprecated_date=date(2025, 6, 1),
        replacement="gemini-3.1-pro",
    ),
    # gemini-2.0-flash series: still functional but not competitive vs 3.1
    'gemini-2.0-flash': ModelInfo(
        'gemini-2.0-flash',
        'deprecated',
        'Google',
        deprecated_date=date(2026, 6, 1),
        replacement='gemini-3.8-flash',
    ),
    'gemini-2.0-flash-lite': ModelInfo(
        'gemini-2.0-flash-lite',
        'deprecated',
        'Google',
        deprecated_date=date(2026, 6, 1),
        replacement='gemini-3.5-flash-lite',
    ),
    # gemini-2.5 series: not competitive vs 3.1 series
    'gemini-2.5-flash-lite': ModelInfo(
        'gemini-2.5-flash-lite',
        'outdated',
        'Google',
        replacement='gemini-3.5-flash-lite',
    ),
    "gemini-2.5-pro": ModelInfo(
        "gemini-2.5-pro",
        "outdated",
        "Google",
        replacement="gemini-3.1-pro",
    ),
    'gemini-2.5-flash': ModelInfo(
        'gemini-2.5-flash',
        'outdated',
        'Google',
        replacement='gemini-3.8-flash',
    ),
    # Image generation models
    'gemini-2.5-flash-image-preview': ModelInfo(
        'gemini-2.5-flash-image-preview',
        'deprecated',
        'Google',
        deprecated_date=date(2026, 1, 15),
        replacement='gemini-3.1-flash-image',
        alternative='Nano Banana 1 shut down Jan 15 2026. Use Nano Banana 2 (gemini-3.1-flash-image-preview)',
    ),
    'gemini-2.5-flash-preview-image-generation': ModelInfo(
        'gemini-2.5-flash-preview-image-generation',
        'deprecated',
        'Google',
        deprecated_date=date(2026, 1, 15),
        replacement='gemini-3.1-flash-image',
    ),
    'gemini-2.5-flash-image': ModelInfo(
        'gemini-2.5-flash-image',
        'deprecated',
        'Google',
        deprecated_date=date(2026, 1, 15),
        replacement='gemini-3.1-flash-image',
    ),
    'gemini-2.5-pro-preview-image-generation': ModelInfo(
        'gemini-2.5-pro-preview-image-generation',
        'deprecated',
        'Google',
        deprecated_date=date(2026, 1, 15),
        replacement='gemini-3.1-flash-image',
    ),
    "gemini-3-pro-preview": ModelInfo(
        "gemini-3-pro-preview",
        "deprecated",
        "Google",
        deprecated_date=date(2026, 3, 9),
        replacement="gemini-3.1-pro",
    ),
    # Old alias used in previous DB versions
    'gemini-3-pro-image-preview': ModelInfo(
        'gemini-3-pro-image-preview',
        'deprecated',
        'Google',
        deprecated_date=date(2026, 3, 9),
        replacement='gemini-3.1-flash-image',
        alternative='Nano Banana Pro shut down March 9 2026. Use Nano Banana 2 (gemini-3.1-flash-image-preview)',
    ),
    # ── DeepSeek deprecated (hard EOL July 24 2026) ───────────────────────
    "deepseek-chat": ModelInfo(
        "deepseek-chat",
        "deprecated",
        "DeepSeek",
        deprecated_date=date(2026, 7, 24),
        replacement="deepseek-v4-pro",
    ),
    "deepseek-reasoner": ModelInfo(
        "deepseek-reasoner",
        "deprecated",
        "DeepSeek",
        deprecated_date=date(2026, 7, 24),
        replacement="deepseek-v4-pro",
    ),
    # ── DeepSeek V3 outdated (superseded by V4) ───────────────────────────
    "deepseek-v3.2": ModelInfo(
        "deepseek-v3.2", "outdated", "DeepSeek", replacement="deepseek-v4-pro"
    ),
    "deepseek-v3.1": ModelInfo(
        "deepseek-v3.1", "outdated", "DeepSeek", replacement="deepseek-v4-pro"
    ),
    "deepseek-v3": ModelInfo(
        "deepseek-v3", "outdated", "DeepSeek", replacement="deepseek-v4-pro"
    ),
    "deepseek-v2": ModelInfo(
        "deepseek-v2",
        "deprecated",
        "DeepSeek",
        deprecated_date=date(2025, 7, 1),
        replacement="deepseek-v4-pro",
    ),
    # ── Chinese models deprecated ─────────────────────────────────────────
    'qwen3.5': ModelInfo(
        'qwen3.5',
        'outdated',
        'Alibaba',
        replacement='qwen3.8-max',
    ),
    'qwen3.5-plus': ModelInfo(
        'qwen3.5-plus',
        'outdated',
        'Alibaba',
        replacement='qwen3.8-max',
    ),
    'qwen3-max': ModelInfo(
        'qwen3-max',
        'outdated',
        'Alibaba',
        replacement='qwen3.8-max',
    ),
    "qwen2": ModelInfo(
        "qwen2",
        "deprecated",
        "Alibaba",
        deprecated_date=date(2025, 9, 1),
        replacement="qwen3",
    ),
    'qwen2.5': ModelInfo(
        'qwen2.5',
        'deprecated',
        'Alibaba',
        deprecated_date=date(2025, 9, 1),
        replacement='qwen3.8-max',
    ),
    "qwen-turbo": ModelInfo(
        "qwen-turbo",
        "outdated",
        "Alibaba",
        replacement="qwen-flash",
    ),
    'kimi-k1': ModelInfo(
        'kimi-k1',
        'deprecated',
        'Moonshot',
        deprecated_date=date(2025, 8, 1),
        replacement='kimi-k2.6',
    ),
    'kimi-k1.5': ModelInfo(
        'kimi-k1.5',
        'deprecated',
        'Moonshot',
        deprecated_date=date(2025, 8, 1),
        replacement='kimi-k2.6',
    ),
    'kimi-latest': ModelInfo(
        'kimi-latest',
        'deprecated',
        'Moonshot',
        deprecated_date=date(2026, 1, 28),
        replacement='kimi-k2.6',
    ),
    'glm-3': ModelInfo(
        'glm-3',
        'deprecated',
        'Zhipu',
        deprecated_date=date(2025, 6, 1),
        replacement='glm-5.3-flash',
    ),
    'glm-4': ModelInfo(
        'glm-4',
        'deprecated',
        'Zhipu',
        deprecated_date=date(2025, 10, 1),
        replacement='glm-5.3-flash',
    ),
    # ── Korean models deprecated ──────────────────────────────────────────
    # kanana-2 was a non-specific alias; use full model ID
    "kanana-2": ModelInfo(
        "kanana-2",
        "deprecated",
        "Kakao",
        deprecated_date=date(2026, 1, 15),
        replacement="kanana-2-30b-a3b-instruct",
    ),
    # ── Tier refresh 2026-09-29 (provider documentation; see sources above) ──
    'claude-opus-4-8': ModelInfo(
        'claude-opus-4-8',
        'outdated',
        'Anthropic',
        replacement='claude-opus-5',
    ),
    'claude-opus-4-7': ModelInfo(
        'claude-opus-4-7',
        'outdated',
        'Anthropic',
        replacement='claude-opus-5',
        tier='flagship',
        capabilities=['text', 'vision', 'extended-thinking'],
        context_window=1000000,
        use_case='Claude Opus 4.7 with improved vision (Apr 2026)',
        cost_tier='high',
    ),
    'claude-fable-5': ModelInfo(
        'claude-fable-5',
        'outdated',
        'Anthropic',
        replacement='claude-fable-5-1',
    ),
    'gpt-5.6-sol': ModelInfo(
        'gpt-5.6-sol',
        'outdated',
        'OpenAI',
        replacement='gpt-6-astra',
    ),
    'gpt-5.6-terra': ModelInfo(
        'gpt-5.6-terra',
        'outdated',
        'OpenAI',
        replacement='gpt-6-sol',
    ),
    'gpt-5.6-luna': ModelInfo(
        'gpt-5.6-luna',
        'outdated',
        'OpenAI',
        replacement='gpt-6-luna',
    ),
    'gpt-5.5': ModelInfo(
        'gpt-5.5',
        'outdated',
        'OpenAI',
        replacement='gpt-6-astra',
        tier='flagship',
        capabilities=['text', 'vision', 'reasoning'],
        context_window=1000000,
        use_case='GPT-5.5 flagship (Apr 2026)',
        cost_tier='high',
    ),
    'gpt-5.5-pro': ModelInfo(
        'gpt-5.5-pro',
        'outdated',
        'OpenAI',
        replacement='gpt-6-astra',
        tier='flagship',
        capabilities=['text', 'vision', 'reasoning', 'extended-thinking'],
        context_window=1000000,
        use_case='Premium GPT-5.5 for highest-capability tasks (Apr 2026)',
        cost_tier='high',
    ),
    'gpt-5.5-instant': ModelInfo(
        'gpt-5.5-instant',
        'outdated',
        'OpenAI',
        replacement='gpt-6-luna',
        tier='fast',
        capabilities=['text', 'vision'],
        context_window=1000000,
        use_case='Fast low-latency GPT-5.5; ChatGPT default (May 2026)',
        cost_tier='low',
    ),
    'gpt-5.4': ModelInfo(
        'gpt-5.4',
        'outdated',
        'OpenAI',
        replacement='gpt-6-astra',
        tier='flagship',
        capabilities=['text', 'vision', 'reasoning'],
        context_window=1000000,
        use_case='GPT-5.4 flagship with 1M context (Mar 2026)',
        cost_tier='high',
    ),
    'gpt-5.4-mini': ModelInfo(
        'gpt-5.4-mini',
        'outdated',
        'OpenAI',
        replacement='gpt-6-sol',
        tier='balanced',
        capabilities=['text', 'vision', 'reasoning'],
        context_window=400000,
        use_case='Cost-efficient GPT-5.4 for low-latency, high-volume workloads',
        cost_tier='low',
    ),
    'gpt-5.4-nano': ModelInfo(
        'gpt-5.4-nano',
        'outdated',
        'OpenAI',
        replacement='gpt-6-luna',
        tier='budget',
        capabilities=['text', 'vision'],
        context_window=400000,
        use_case='Fastest and cheapest GPT-5.4 model',
        cost_tier='low',
    ),
    'gpt-4.1': ModelInfo(
        'gpt-4.1',
        'outdated',
        'OpenAI',
        replacement='gpt-6-sol',
        tier='flagship',
        capabilities=['text', 'vision'],
        context_window=1048576,
        use_case='Coding, instruction-following, and long-context tasks',
        cost_tier='medium',
    ),
    'gpt-4.1-mini': ModelInfo(
        'gpt-4.1-mini',
        'outdated',
        'OpenAI',
        replacement='gpt-6-luna',
        tier='balanced',
        capabilities=['text', 'vision'],
        context_window=1048576,
        use_case='Balanced performance with 1M token context at low cost',
        cost_tier='low',
    ),
    'gpt-4.1-nano': ModelInfo(
        'gpt-4.1-nano',
        'deprecated',
        'OpenAI',
        deprecated_date=date(2026, 10, 23),
        replacement='gpt-6-luna',
        tier='budget',
        capabilities=['text'],
        context_window=1048576,
        use_case='Fastest and cheapest OpenAI model with 1M token context',
        cost_tier='low',
    ),
    'gemini-3.7-flash': ModelInfo(
        'gemini-3.7-flash',
        'outdated',
        'Google',
        replacement='gemini-3.8-flash',
        tier='flagship',
        capabilities=['text', 'vision', 'audio', 'thinking'],
        context_window=1000000,
        use_case='Latest Gemini flagship (Sep 2026)',
        cost_tier='high',
    ),
    'gemini-3.6-flash': ModelInfo(
        'gemini-3.6-flash',
        'outdated',
        'Google',
        replacement='gemini-3.8-flash',
    ),
    'gemini-3.5-flash': ModelInfo(
        'gemini-3.5-flash',
        'outdated',
        'Google',
        replacement='gemini-3.8-flash',
        tier='flagship',
        capabilities=['text', 'vision', 'audio', 'thinking'],
        context_window=1000000,
        use_case='Gemini 3.5 flagship (May 2026)',
        cost_tier='high',
    ),
    'gemini-3-flash-preview': ModelInfo(
        'gemini-3-flash-preview',
        'outdated',
        'Google',
        replacement='gemini-3.8-flash',
        tier='balanced',
        capabilities=['text', 'vision', 'audio', 'thinking'],
        context_window=1000000,
        use_case='Fast thinking model with configurable reasoning levels (Dec 2025)',
        cost_tier='medium',
    ),
    'gemini-3.1-flash-lite': ModelInfo(
        'gemini-3.1-flash-lite',
        'outdated',
        'Google',
        deprecated_date=date(2027, 5, 7),
        replacement='gemini-3.5-flash-lite',
        tier='budget',
        capabilities=['text', 'vision', 'audio'],
        context_window=1000000,
        use_case='Most cost-effective Gemini 3.1 model (GA, Mar 2026)',
        cost_tier='low',
    ),
    'gemini-3.1-flash-image-preview': ModelInfo(
        'gemini-3.1-flash-image-preview',
        'deprecated',
        'Google',
        deprecated_date=date(2026, 6, 25),
        replacement='gemini-3.1-flash-image',
        tier='balanced',
        capabilities=['text', 'vision', 'image-generation'],
        context_window=65536,
        use_case='Nano Banana 2 — SOTA image generation, 4K output (Feb 2026)',
        cost_tier='medium',
    ),
    'qwen3.7-max': ModelInfo(
        'qwen3.7-max',
        'outdated',
        'Alibaba',
        replacement='qwen3.8-max',
        tier='flagship',
        capabilities=['text', 'vision', 'reasoning', 'thinking'],
        context_window=1000000,
        use_case='Qwen 3.7 API flagship with native thinking mode (May 2026)',
        cost_tier='high',
    ),
    'qwen3.7-flash': ModelInfo(
        'qwen3.7-flash',
        'outdated',
        'Alibaba',
        replacement='qwen3.8-flash',
        tier='fast',
        cost_tier='low',
    ),
    'qwen3.6-plus': ModelInfo(
        'qwen3.6-plus',
        'outdated',
        'Alibaba',
        replacement='qwen3.7-plus',
        tier='balanced',
        capabilities=['text', 'reasoning'],
        context_window=1000000,
        use_case='Qwen 3.6 Plus — agentic balanced model, latest HuggingFace release',
        cost_tier='medium',
    ),
    'qwen3.6-plus-preview': ModelInfo(
        'qwen3.6-plus-preview',
        'outdated',
        'Alibaba',
        replacement='qwen3.7-plus',
        tier='balanced',
        capabilities=['text', 'reasoning'],
        context_window=1000000,
        use_case='Qwen 3.6 agentic balanced model API preview (Apr 2026)',
        cost_tier='medium',
    ),
    'qwen3.5-flash': ModelInfo(
        'qwen3.5-flash',
        'outdated',
        'Alibaba',
        replacement='qwen3.8-flash',
        tier='fast',
        capabilities=['text', 'vision', 'reasoning'],
        context_window=1000000,
        use_case='Fast Qwen3.5 hosted API (35B/3B MoE)',
        cost_tier='low',
    ),
    'deepseek-v4-flash': ModelInfo(
        'deepseek-v4-flash',
        'deprecated',
        'DeepSeek',
        replacement='deepseek-flash',
        tier='balanced',
        capabilities=['text', 'code', 'reasoning'],
        context_window=1000000,
        use_case='DeepSeek V4 efficient MoE (284B/13B active, Apr 2026)',
        cost_tier='low',
    ),
    'kimi-k2.5': ModelInfo(
        'kimi-k2.5',
        'outdated',
        'Moonshot',
        replacement='kimi-k2.6',
        tier='flagship',
        capabilities=['text', 'vision', 'reasoning'],
        context_window=256000,
        use_case='Flagship Kimi model with agent swarm support (Jan 2026)',
        cost_tier='medium',
    ),
    'kimi-k2': ModelInfo(
        'kimi-k2',
        'outdated',
        'Moonshot',
        replacement='kimi-k2.6',
        tier='balanced',
        capabilities=['text', 'code', 'reasoning'],
        context_window=256000,
        use_case='Open-weight Kimi K2 base model (1T/32B MoE)',
        cost_tier='medium',
    ),
    'glm-5.2': ModelInfo(
        'glm-5.2',
        'outdated',
        'Zhipu',
        replacement='glm-5.3',
    ),
    'glm-4.7': ModelInfo(
        'glm-4.7',
        'outdated',
        'Zhipu',
        replacement='glm-5.3-flash',
        tier='flagship',
        capabilities=['text', 'code', 'reasoning'],
        context_window=200000,
        use_case='Zhipu flagship: 358B MoE, top SWE-bench and coding scores',
        cost_tier='medium',
    ),
    'glm-4.6': ModelInfo(
        'glm-4.6',
        'outdated',
        'Zhipu',
        replacement='glm-5.3-flash',
    ),
    'glm-4.5': ModelInfo(
        'glm-4.5',
        'outdated',
        'Zhipu',
        replacement='glm-5.3-flash',
    ),
    'solar-pro3': ModelInfo(
        'solar-pro3',
        'outdated',
        'Upstage',
        replacement='solar-pro4',
        tier='flagship',
        capabilities=['text', 'reasoning'],
        context_window=128000,
        use_case='Upstage flagship 102B MoE with reasoning (Mar 2026)',
        cost_tier='medium',
    ),
    'solar-pro2': ModelInfo(
        'solar-pro2',
        'outdated',
        'Upstage',
        replacement='solar-pro4',
        tier='balanced',
        capabilities=['text'],
        context_window=65536,
        use_case='Compact 31B model with hybrid reasoning (May 2025)',
        cost_tier='medium',
    ),
    'k-exaone-236b-a23b': ModelInfo(
        'k-exaone-236b-a23b',
        'outdated',
        'LG',
        replacement='k-exaone-2.0-750b-a37b',
        tier='flagship',
        capabilities=['text', 'reasoning'],
        context_window=256000,
        use_case='Korean frontier MoE 236B/23B, ranked 7th worldwide (Jan 2026)',
        cost_tier='low',
    ),
    'exaone-4.0-32b': ModelInfo(
        'exaone-4.0-32b',
        'outdated',
        'LG',
        replacement='exaone-4.5-33b',
        tier='flagship',
        capabilities=['text', 'reasoning'],
        context_window=128000,
        use_case='Unified reasoning model with hybrid attention (Jul 2025)',
        cost_tier='low',
    ),
    'exaone-4.0.1-32b': ModelInfo(
        'exaone-4.0.1-32b',
        'outdated',
        'LG',
        replacement='exaone-4.5-33b',
    ),
}

# Deprecated pattern matchers (for version family patterns)
DEPRECATED_PATTERNS = [
    # Alibaba Qwen - only v2.x is deprecated
    (re.compile(r"qwen2\.?\d*"), "qwen3.8-max", "Alibaba"),
    # Moonshot Kimi - only k1.x is deprecated
    (re.compile(r"kimi-k1\.?\d*"), "kimi-k2.6", "Moonshot"),
    # Zhipu GLM - only v0-3 are deprecated, v4.x are current
    (re.compile(r"glm-[0-3](?:\.\d+)?$"), "glm-5.3-flash", "Zhipu"),
    # Anthropic Claude - all v3.x are deprecated
    (re.compile(r"claude-3-.*"), "claude-sonnet-5", "Anthropic"),
    # OpenAI GPT - only v3 and base v4 are deprecated
    (re.compile(r"gpt-3\.5-turbo"), "gpt-6-luna", "OpenAI"),
    (re.compile(r"gpt-4-turbo"), "gpt-6-sol", "OpenAI"),
    (re.compile(r"^gpt-4$"), "gpt-6-sol", "OpenAI"),
    # OpenAI o-series - only o1-series is deprecated (o3/o4 are outdated)
    (re.compile(r"o1(?:-preview|-mini|-pro)?$"), "gpt-6-astra", "OpenAI"),
    # Google Gemini - all v1.x are fully deprecated
    (re.compile(r"gemini-1\.\d+-.*"), "gemini-3.5-flash-lite", "Google"),
    # DeepSeek - v3.x series superseded by v4
    (re.compile(r"deepseek-v3(?:\.\d+)?"), "deepseek-v4-pro", "DeepSeek"),
]


def normalize_model_name(model: str) -> str:
    """Normalize model name by removing provider prefixes and cleaning up."""
    # Remove common provider prefixes
    model = re.sub(
        r"^(openai|anthropic|google|alibaba|moonshot|deepseek|zhipu|upstage):",
        "",
        model,
        flags=re.IGNORECASE,
    )
    model = re.sub(
        r"^(gpt|claude|gemini|qwen|kimi|deepseek|glm|solar|kanana|exaone)/",
        "",
        model,
        flags=re.IGNORECASE,
    )

    # Normalize common variations
    model = model.strip()

    return model


def check_model_status(model: str) -> tuple[bool, Optional[ModelInfo]]:
    """
    Check if a model is deprecated.

    Returns:
        (is_deprecated, model_info): Tuple indicating if model is deprecated and its info
    """
    normalized = normalize_model_name(model)

    # Check exact match in current models
    if normalized in CURRENT_MODELS:
        return False, CURRENT_MODELS[normalized]

    # Check exact match in deprecated models
    if normalized in DEPRECATED_MODELS:
        return True, DEPRECATED_MODELS[normalized]

    # Check pattern matches for version families
    for pattern, replacement, provider in DEPRECATED_PATTERNS:
        if pattern.match(normalized):
            info = ModelInfo(
                normalized, "deprecated", provider, replacement=replacement
            )
            return True, info

    # Unknown model - allow (fail-open)
    return False, None


def get_all_model_names() -> set[str]:
    """Get all known model names for pattern matching."""
    names = set()
    names.update(CURRENT_MODELS.keys())
    names.update(DEPRECATED_MODELS.keys())
    return names
