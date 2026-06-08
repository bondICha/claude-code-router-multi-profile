# Claude Code Router - Multi-Profile 分支

[![English](https://img.shields.io/badge/%F0%9F%87%AC%F0%9F%87%A7-English-000aff?style=flat)](README.md)
[![License](https://img.shields.io/github/license/musistudio/claude-code-router)](https://github.com/musistudio/claude-code-router/blob/main/LICENSE)

> **基于 [musistudio/claude-code-router](https://github.com/musistudio/claude-code-router) 的分支**，新增 **按客户端的模型配置 (Per-Client Profiles)** —— 可直接在 Claude Code 原生的 `/model` 选择器中选择。

---

## ✨ 此分支的差异点

上游的 Claude Code Router 允许你为每个场景（`default`、`think`、`longContext` 等）定义一套路由方案。本分支增加了 **模型 Profiles** 的概念：每个 Profile 是一套完整的路由方案，可以为每个场景独立指定模型。

Profiles 会以模型的形式出现在 Claude Code 内建的 `/model` 选择器中。每个 Claude Code 实例独立挑选自己的 Profile，路由器会按该 Profile 的配置处理每一个请求。

**示例 —— 三个 Profile，各自有不同的默认配置：**

```
┌─ Profile "glm" ─────────────────────────────────┐
│  default:    volcengine, glm-5.1                  │
│  think:      volcengine, glm-5.1                  │
│  longContext:opencode-go-anthropic, deepseek-v4   │
│  image:      opencode-go, mimo-v2.5               │
│  background: volcengine, glm-5.1                  │
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

在 Claude Code 中切换 Profile，使用 `/model claude-code/<profile-id>`：

```
/model claude-code/glm       # → GLM-5.1 profile
/model claude-code/deepseek  # → DeepSeek V4 Pro profile
/model claude-code/qwen      # → Qwen 3.7 profile
/model claude-code/sonnet    # → Claude Sonnet profile
```

### 此分支的其他改动

| 特性 | 说明 |
|---|---|
| **Gateway Model Discovery（网关模型自动发现）** | Profiles 会通过 `GET /v1/models` 端点被 Claude Code 自动发现（需设置 `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`）。该设计灵感来自 [rosetta-llm](https://github.com/Lokesh-Chimakurthi/rosetta-llm)，其首创以 `claude-code/` 前缀让非 Anthropic 模型出现在 Claude Code 的选择器中。 |
| **内建 Fallback 链** | 每个场景都可在 `fallback` 块中配置带优先级的备选清单。 |
| **Dockerfile 升级** | 升级至 `node:26-alpine`，并改用 BuildKit cache mounts 以加快构建。 |

其余功能 —— 多 Provider 支持、Transformers、Preset 系统、UI、CLI —— 与上游完全一致。

---

## 🚀 快速开始

### 1. 安装 Claude Code

```shell
npm install -g @anthropic-ai/claude-code
```

### 2. 安装 Claude Code Router

```shell
npm install -g @musistudio/claude-code-router
```

### 3. 配置

复制示例配置后修改：

```shell
cp config.example.json ~/.claude-code-router/config.json
```

将各家 API Key 设置为环境变量（`VOLCENGINE_API_KEY`、`OCGO_API_KEY`、`DEEPSEEK_API_KEY`、`ANTHROPIC_API_KEY` 等），或直接写在 `config.json` 中。

完整的配置格式请参考 [`config.example.json`](config.example.json)。

### 4. 启动路由器并运行

```shell
ccr start
ccr code
```

在 Claude Code 中通过以下方式选择 Profile：

```
/model claude-code/glm
```

---

## 📖 文档

- 上游 README（详细的功能文档、Transformer 参考、GitHub Actions 集成、Presets 等）
- 上游博客：[项目动机](https://github.com/musistudio/claude-code-router/blob/main/blog/zh/项目动机和工作原理.md)、[自定义路由](https://github.com/musistudio/claude-code-router/blob/main/blog/zh/也许我们可以用路由器做更多事.md)

---

## 🙏 致谢

本分支基于上游项目 [musistudio/claude-code-router](https://github.com/musistudio/claude-code-router) 构建。所有基础功能 —— 路由引擎、Transformers、多 Provider 支持、Preset 系统、CLI、UI —— 均来自上游团队。

Gateway Model Discovery 的设计思路（使用 `GET /v1/models` 配合 `claude-code/` 前缀让非 Anthropic 模型出现在 Claude Code 的 `/model` 选择器中）借鉴自 [Lokesh-Chimakurthi/rosetta-llm](https://github.com/Lokesh-Chimakurthi/rosetta-llm) —— 该项目首先在其代理实现中采用了这一模式。

---

## 📄 许可证

与上游项目使用相同的许可证条款。详见 [LICENSE](https://github.com/musistudio/claude-code-router/blob/main/LICENSE)。
