// Speed benchmark: Huoshan (volcengine) vs OpenCode (opencode-go) providers.
//
// Hits each provider's endpoint directly with an identical streaming prompt and
// measures TTFT (time to first token), total wall time, and generation throughput
// in output tokens/sec. Runs a few iterations per target and reports the median.
//
// Keys are read from process.env (a minimal inline .env loader is included so the
// script can be run with `node bench-speed.mjs` from the repo root). The script
// never prints key material.
//
// Usage:
//   node bench-speed.mjs                # default 3 iterations per target
//   ITER=5 node bench-speed.mjs         # more iterations
//   ONLY=dsv4 node bench-speed.mjs      # filter targets by label substring

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal .env loader — only sets vars not already present in the environment.
function loadEnv() {
  const envPath = join(__dirname, ".env");
  if (!existsSync(envPath)) return;
  const txt = readFileSync(envPath, "utf8");
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnv();

const ITER = Number(process.env.ITER ?? 3);
// Comma-separated label substrings; empty = all targets.
const ONLY = process.env.ONLY ?? "";

// A coding task that produces a moderate, comparable amount of output across
// models. Kept model-agnostic so no provider has a prompt advantage.
const PROMPT =
  "Write a TypeScript class implementing a least-recently-used (LRU) cache with " +
  "get(key) and put(key, value) methods, both O(1). Include inline comments and a " +
  "short usage example at the end. Do not use any libraries.";

const MAX_TOKENS = 1024;

// Each target points at a provider endpoint directly. The `format` field selects
// the request shape and SSE parser. deepseek-v4-pro is intentionally listed under
// both providers so the same model can be compared across providers.
const TARGETS = [
  {
    label: "Huoshan/dsv4pro",
    url: "https://ark.cn-beijing.volces.com/api/coding/v1/messages",
    key: process.env.VOLCENGINE_API_KEY,
    model: "deepseek-v4-pro",
    format: "anthropic",
  },
  {
    label: "OpenCode/dsv4pro",
    url: "https://opencode.ai/zen/go/v1/messages",
    key: process.env.OCGO_API_KEY,
    model: "deepseek-v4-pro",
    format: "anthropic",
  },
  {
    label: "OpenCode/glm-5.2",
    url: "https://opencode.ai/zen/go/v1/chat/completions",
    key: process.env.OCGO_API_KEY,
    model: "glm-5.2",
    format: "openai",
  },
  {
    label: "Huoshan/glm-latest",
    url: "https://ark.cn-beijing.volces.com/api/coding/v1/messages",
    key: process.env.VOLCENGINE_API_KEY,
    model: "glm-latest",
    format: "anthropic",
  },
  {
    label: "OpenCode/kimi-k2.7-code",
    url: "https://opencode.ai/zen/go/v1/chat/completions",
    key: process.env.OCGO_API_KEY,
    model: "kimi-k2.7-code",
    format: "openai",
  },
  {
    label: "Huoshan/kimi-k2.7-code",
    url: "https://ark.cn-beijing.volces.com/api/coding/v1/messages",
    key: process.env.VOLCENGINE_API_KEY,
    model: "kimi-k2.7-code",
    format: "anthropic",
  },
  {
    label: "Huoshan/doubao-seed-code",
    url: "https://ark.cn-beijing.volces.com/api/coding/v1/messages",
    key: process.env.VOLCENGINE_API_KEY,
    model: "doubao-seed-code",
    format: "anthropic",
  },
  {
    label: "OpenCode/qwen3.7-max",
    url: "https://opencode.ai/zen/go/v1/chat/completions",
    key: process.env.OCGO_API_KEY,
    model: "qwen3.7-max",
    format: "openai",
  },
  {
    label: "OpenCode/mimo-v2.5-pro",
    url: "https://opencode.ai/zen/go/v1/chat/completions",
    key: process.env.OCGO_API_KEY,
    model: "mimo-v2.5-pro",
    format: "openai",
  },
];

function buildBody(t) {
  if (t.format === "anthropic") {
    return {
      model: t.model,
      max_tokens: MAX_TOKENS,
      stream: true,
      // Canonical Anthropic content-block form — some Anthropic-compat wrappers
      // (e.g. opencode-go) reject plain-string content with "Empty input messages".
      messages: [{ role: "user", content: [{ type: "text", text: PROMPT }] }],
    };
  }
  return {
    model: t.model,
    max_tokens: MAX_TOKENS,
    stream: true,
    stream_options: { include_usage: true },
    messages: [{ role: "user", content: PROMPT }],
  };
}

function buildHeaders(t) {
  if (t.format === "anthropic") {
    return {
      "content-type": "application/json",
      "x-api-key": t.key,
      "anthropic-version": "2023-06-01",
    };
  }
  return {
    "content-type": "application/json",
    authorization: `Bearer ${t.key}`,
  };
}

// Run one streaming request. Returns { ttftMs, totalMs, outputTokens, error }.
// ttftMs = time from request start to first content token.
// totalMs = time from request start to stream end.
// outputTokens = real token count (from usage events) when available.
async function runOnce(t) {
  const t0 = performance.now();
  let firstContentAt = null;
  let outputTokens = null;

  const res = await fetch(t.url, {
    method: "POST",
    headers: buildHeaders(t),
    body: JSON.stringify(buildBody(t)),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    return { ttftMs: 0, totalMs: 0, outputTokens: 0, error: `HTTP ${res.status} ${text.slice(0, 200)}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // Process complete SSE lines.
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        let line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        line = line.replace(/\r$/, "").trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        let evt;
        try {
          evt = JSON.parse(data);
        } catch {
          continue;
        }

        if (firstContentAt === null) {
          let text = "";
          if (t.format === "anthropic") {
            if (evt?.delta?.type === "text_delta") text = evt.delta.text;
            // Some Anthropic-compat wrappers surface reasoning text here.
            else if (evt?.delta?.reasoning_content) text = evt.delta.reasoning_content;
          } else {
            const d = evt?.choices?.[0]?.delta;
            text = d?.content ?? d?.reasoning_content ?? "";
          }
          if (text) firstContentAt = performance.now();
        }

        // Capture real output token counts from usage events.
        if (t.format === "anthropic") {
          // message_delta carries the final usage.output_tokens.
          if (evt?.type === "message_delta" && evt?.usage?.output_tokens != null) {
            outputTokens = evt.usage.output_tokens;
          }
        } else {
          if (evt?.usage?.completion_tokens != null) {
            outputTokens = evt.usage.completion_tokens;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const totalMs = performance.now() - t0;
  const ttftMs = firstContentAt != null ? firstContentAt - t0 : totalMs;
  return { ttftMs, totalMs, outputTokens: outputTokens ?? 0, error: null };
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fmt(n, digits = 0) {
  if (n == null || !isFinite(n)) return "-";
  return n.toFixed(digits);
}

async function main() {
  const onlyList = ONLY.split(",").map((s) => s.trim()).filter(Boolean);
  const targets = TARGETS.filter(
    (t) => !onlyList.length || onlyList.some((s) => t.label.includes(s))
  );

  // Validate keys up front so missing env vars are reported clearly.
  const missing = targets.filter((t) => !t.key);
  if (missing.length) {
    console.error("Missing API key for: " + missing.map((t) => t.label).join(", "));
    console.error("Set the relevant env vars (or add them to .env) and retry.");
    process.exit(1);
  }

  console.log(`\nSpeed benchmark — ${ITER} iteration(s) per target, max_tokens=${MAX_TOKENS}`);
  console.log("Prompt: " + PROMPT.slice(0, 80) + "...\n");

  const results = [];

  for (const t of targets) {
    const runs = [];
    for (let i = 0; i < ITER; i++) {
      process.stdout.write(`  [${t.label}] run ${i + 1}/${ITER} ... `);
      const r = await runOnce(t);
      if (r.error) {
        console.log(`ERROR: ${r.error}`);
      } else {
        const genMs = r.totalMs - r.ttftMs;
        const tps = genMs > 0 ? (r.outputTokens / genMs) * 1000 : 0;
        console.log(
          `TTFT=${fmt(r.ttftMs)}ms  total=${fmt(r.totalMs)}ms  ` +
            `tokens=${r.outputTokens}  ${fmt(tps, 1)} tok/s`
        );
        runs.push(r);
      }
    }
    if (!runs.length) {
      results.push({ label: t.label, ok: false });
      continue;
    }
    const ttft = median(runs.map((r) => r.ttftMs));
    const total = median(runs.map((r) => r.totalMs));
    const tokens = median(runs.map((r) => r.outputTokens));
    const gen = total - ttft;
    const tps = gen > 0 ? (tokens / gen) * 1000 : 0;
    results.push({ label: t.label, ok: true, ttft, total, tokens, tps });
  }

  // Summary table.
  console.log("\n=== Summary (medians) ===");
  console.log(
    "target".padEnd(28) +
      "TTFT(ms)".padStart(10) +
      "total(ms)".padStart(11) +
      "tokens".padStart(8) +
      "tok/s".padStart(9)
  );
  console.log("-".repeat(66));
  for (const r of results) {
    if (!r.ok) {
      console.log(r.label.padEnd(28) + "FAILED".padStart(10));
      continue;
    }
    console.log(
      r.label.padEnd(28) +
        fmt(r.ttft).padStart(10) +
        fmt(r.total).padStart(11) +
        String(r.tokens).padStart(8) +
        fmt(r.tps, 1).padStart(9)
    );
  }

  // Head-to-head for the shared model, if both ran.
  const h = results.find((r) => r.label === "Huoshan/dsv4pro");
  const o = results.find((r) => r.label === "OpenCode/dsv4pro");
  if (h?.ok && o?.ok) {
    console.log("\n=== deepseek-v4-pro head-to-head ===");
    console.log(`  Huoshan : TTFT ${fmt(h.ttft)}ms  total ${fmt(h.total)}ms  ${fmt(h.tps, 1)} tok/s`);
    console.log(`  OpenCode: TTFT ${fmt(o.ttft)}ms  total ${fmt(o.total)}ms  ${fmt(o.tps, 1)} tok/s`);
    const ttftRatio = h.ttft / o.ttft;
    const totalRatio = h.total / o.total;
    console.log(
      `  Huoshan TTFT  is ${fmt(ttftRatio, 2)}x OpenCode  |  total ${fmt(totalRatio, 2)}x OpenCode`
    );
  }

  // GLM head-to-head: Huoshan's glm-latest == OpenCode's glm-5.2.
  const gh = results.find((r) => r.label === "Huoshan/glm-latest");
  const go = results.find((r) => r.label === "OpenCode/glm-5.2");
  if (gh?.ok && go?.ok) {
    console.log("\n=== GLM head-to-head (glm-latest vs glm-5.2) ===");
    console.log(`  Huoshan : TTFT ${fmt(gh.ttft)}ms  total ${fmt(gh.total)}ms  ${fmt(gh.tps, 1)} tok/s`);
    console.log(`  OpenCode: TTFT ${fmt(go.ttft)}ms  total ${fmt(go.total)}ms  ${fmt(go.tps, 1)} tok/s`);
    const ttftRatio = gh.ttft / go.ttft;
    const totalRatio = gh.total / go.total;
    console.log(
      `  Huoshan TTFT  is ${fmt(ttftRatio, 2)}x OpenCode  |  total ${fmt(totalRatio, 2)}x OpenCode`
    );
  }

  // kimi-k2.7-code head-to-head (both providers expose this model).
  const kh = results.find((r) => r.label === "Huoshan/kimi-k2.7-code");
  const ko = results.find((r) => r.label === "OpenCode/kimi-k2.7-code");
  if (kh?.ok && ko?.ok) {
    console.log("\n=== kimi-k2.7-code head-to-head ===");
    console.log(`  Huoshan : TTFT ${fmt(kh.ttft)}ms  total ${fmt(kh.total)}ms  ${fmt(kh.tps, 1)} tok/s`);
    console.log(`  OpenCode: TTFT ${fmt(ko.ttft)}ms  total ${fmt(ko.total)}ms  ${fmt(ko.tps, 1)} tok/s`);
    const ttftRatio = kh.ttft / ko.ttft;
    const totalRatio = kh.total / ko.total;
    console.log(
      `  Huoshan TTFT  is ${fmt(ttftRatio, 2)}x OpenCode  |  total ${fmt(totalRatio, 2)}x OpenCode`
    );
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
