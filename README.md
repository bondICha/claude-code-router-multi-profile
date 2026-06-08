# Claude Code Router - Multi-Profile Fork

[![](https://img.shields.io/badge/%F0%9F%87%A8%F0%9F%87%B3-%E4%B8%AD%E6%96%87%E7%89%88-ff0000?style=flat)](README_zh.md)
[![License](https://img.shields.io/github/license/musistudio/claude-code-router)](https://github.com/musistudio/claude-code-router/blob/main/LICENSE)

> **A fork of [musistudio/claude-code-router](https://github.com/musistudio/claude-code-router)** adding **per-client model profiles** — selectable from Claude Code's native `/model` picker.

---

## ✨ What's Different in This Fork

Upstream Claude Code Router lets you define one routing plan per scenario (`default`, `think`, `longContext`, etc.). This fork adds **model profiles**: each profile is a complete routing plan with its own model assignment for every scenario.

Profiles appear as models in Claude Code's built-in `/model` picker. Each Claude Code instance picks its own profile, and the router applies that profile's routing for every request.

**Example — four profiles using Volcengine, OpenCode Go (Zen), DeepSeek direct, and Anthropic direct:**

```
┌─ Profile "glm" ─────────────────────────────────┐
│  default:    volcengine, glm-5.1                 │
│  think:      volcengine, glm-5.1                 │
│  longContext:opencode-go-anthropic, deepseek-v4  │
│  image:      opencode-go, mimo-v2.5              │
│  background: volcengine, glm-5.1                 │
└──────────────────────────────────────────────────┘

┌─ Profile "deepseek" ────────────────────────────┐
│  default:    opencode-go-anthropic, deepseek-v4  │
│  think:      opencode-go-anthropic, deepseek-v4  │
│  longContext:opencode-go-anthropic, deepseek-v4  │
│  image:      opencode-go, mimo-v2.5              │
│  background: volcengine, glm-5.1                 │
└──────────────────────────────────────────────────┘

┌─ Profile "qwen" ────────────────────────────────┐
│  default:    opencode-go, qwen3.7-max            │
│  think:      opencode-go, qwen3.7-max            │
│  longContext:opencode-go, mimo-v2.5-pro          │
│  image:      opencode-go, qwen3.7-plus           │
│  background: volcengine, glm-5.1                 │
└──────────────────────────────────────────────────┘

┌─ Profile "sonnet" ──────────────────────────────┐
│  default:    anthropic, claude-sonnet-4.5         │
│  think:      anthropic, claude-sonnet-4.5         │
│  longContext:anthropic, claude-sonnet-4.5         │
│  image:      opencode-go, mimo-v2.5              │
│  background: volcengine, glm-5.1                 │
└───────────────────────────────────────────────────┘
```

Switch profiles in-claude with `/model claude-code/<profile-id>`:

```
/model claude-code/glm       # → GLM-5.1 profile
/model claude-code/deepseek  # → DeepSeek V4 Pro profile
/model claude-code/qwen      # → Qwen 3.7 profile
/model claude-code/sonnet    # → Claude Sonnet profile
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

This fork is run as a **Docker** container — it is **not** published to npm
(the built-in profile router lives in this repo's build). You run the router in
Docker, then point your Claude Code client at it.

### 1. Get the code

```shell
git clone https://github.com/bondICha/claude-code-router-multi-profile.git
cd claude-code-router-multi-profile
```

### 2. Configure

```shell
mkdir -p data
cp config.example.json data/config.json
# edit data/config.json: providers, models, and your Profiles block
```

Provide secrets via a `.env` file next to the compose context — the config
interpolates `${VAR}` references:

```shell
# .env
CCR_API_KEY=sk-ccr-your-secret
VOLCENGINE_API_KEY=...
OCGO_API_KEY=...
DEEPSEEK_API_KEY=...
ANTHROPIC_API_KEY=...
```

### 3. Build & run the router with Docker Compose

Create a `docker-compose.yml`:

```yaml
services:
  ccr:
    build:
      context: .
      dockerfile: packages/server/Dockerfile
    container_name: ccr
    ports:
      - "3456:3456"
    env_file:
      - .env
    volumes:
      - ./data:/root/.claude-code-router
    restart: always
```

Then:

```shell
docker compose up -d --build
```

`./data` is mounted to `/root/.claude-code-router`, so `data/config.json` is the
live config and logs land in `data/logs/`.

### 4. Point Claude Code at the router (client side)

On the machine where you run Claude Code (install it with
`npm install -g @anthropic-ai/claude-code`), set:

```shell
export ANTHROPIC_BASE_URL=http://localhost:3456      # or your server's URL
export ANTHROPIC_AUTH_TOKEN=sk-ccr-your-secret       # = CCR_API_KEY
export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1  # REQUIRED on the client
claude
```

`CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` is **required on the client** — it
is what makes Claude Code query `GET /v1/models` and list your profiles in the
native `/model` picker. Then switch between them:

```
/model claude-code/glm
/model claude-code/deepseek
/model claude-code/qwen
/model claude-code/sonnet
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