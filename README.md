# Claude Code Router - Multi-Profile Fork

[![License](https://img.shields.io/github/license/musistudio/claude-code-router)](https://github.com/musistudio/claude-code-router/blob/main/LICENSE)

> **A fork of [musistudio/claude-code-router](https://github.com/musistudio/claude-code-router)** adding **per-client model profiles** — selectable from Claude Code's native `/model` picker.

---

## ✨ What's Different in This Fork

Upstream Claude Code Router lets you define one routing plan per scenario (`default`, `think`, `longContext`, etc.). This fork adds **model profiles**: each profile is a complete routing plan with its own model assignment for every scenario.

Profiles appear as models in Claude Code's built-in `/model` picker. Each Claude Code instance picks its own profile, and the router applies that profile's routing for every request.

**Example — three profiles, each with different defaults:**

```
┌─ Profile "gpt4o" ──────────────────────────────┐
│  default:    openai, gpt-4o                     │
│  think:      deepseek, deepseek-reasoner        │
│  longContext:anthropic, claude-sonnet-4          │
│  image:      openai, gpt-4o                     │
│  background: openai, gpt-4o-mini                │
└─────────────────────────────────────────────────┘

┌─ Profile "sonnet" ──────────────────────────────┐
│  default:    anthropic, claude-sonnet-4          │
│  think:      deepseek, deepseek-reasoner        │
│  longContext:anthropic, claude-sonnet-4          │
│  image:      openai, gpt-4o                     │
│  background: openai, gpt-4o-mini                │
└─────────────────────────────────────────────────┘

┌─ Profile "deepseek" ────────────────────────────┐
│  default:    deepseek, deepseek-chat            │
│  think:      deepseek, deepseek-reasoner        │
│  longContext:deepseek, deepseek-chat            │
│  image:      openai, gpt-4o                     │
│  background: deepseek, deepseek-chat            │
└─────────────────────────────────────────────────┘
```

Switch profiles in-claude with `/model claude-code/<profile-id>`:

```
/model claude-code/sonnet    # → Sonnet profile
/model claude-code/deepseek  # → DeepSeek profile
```

### What else is in this fork

| Feature | Detail |
|---|---|
| **Gateway Model Discovery** | Profiles are auto-discovered by Claude Code via `GET /v1/models` (enable with `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`). Inspired by [rosetta-llm](https://github.com/Lokesh-Chimakurthi/rosetta-llm)'s `claude-code/` prefix approach for surfacing non-Anthropic models in Claude Code's picker. |
| **Built-in fallback chains** | Each scenario can have a prioritized fallback list in the `fallback` block. |
| **Dockerfile refresh** | Bumped to `node:26-alpine`, switched to BuildKit cache mounts for faster builds. |

Everything else — multi-provider support, transformers, preset system, UI, CLI — works identically to upstream.

---

## 🚀 Quick Start

### 1. Install Claude Code

```shell
npm install -g @anthropic-ai/claude-code
```

### 2. Install Claude Code Router

```shell
npm install -g @musistudio/claude-code-router
```

### 3. Configure

Copy the example and edit:

```shell
cp config.example.json ~/.claude-code-router/config.json
```

Set your API keys as environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, etc.) or inline in `config.json`.

See [`config.example.json`](config.example.json) for the complete format.

### 4. Start the router and run

```shell
ccr start
ccr code
```

Inside Claude Code, pick a profile with:

```
/model claude-code/gpt4o
```

---

## 📖 Documentation

- Upstream README: detailed feature docs, transformer reference, GitHub Actions integration, presets
- Blog posts (upstream): [project motivation](https://github.com/musistudio/claude-code-router/blob/main/blog/en/project-motivation-and-how-it-works.md), [custom routing](https://github.com/musistudio/claude-code-router/blob/main/blog/en/maybe-we-can-do-more-with-the-route.md)

---

## 🙏 Credits

This fork builds on [musistudio/claude-code-router](https://github.com/musistudio/claude-code-router), the upstream project. All base features — routing engine, transformers, multi-provider support, preset system, CLI, UI — come from the upstream team.

The Gateway Model Discovery design (`GET /v1/models` with `claude-code/` prefix to register non-Anthropic models in Claude Code's `/model` picker) is borrowed from [Lokesh-Chimakurthi/rosetta-llm](https://github.com/Lokesh-Chimakurthi/rosetta-llm), which pioneered the pattern for its proxy.

---

## 📄 License

Licensed under the same terms as the upstream project. See [LICENSE](https://github.com/musistudio/claude-code-router/blob/main/LICENSE).