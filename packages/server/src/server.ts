import Server, { calculateTokenCount, TokenizerService } from "@musistudio/llms";
import { readConfigFile, writeConfigFile, backupConfigFile } from "./utils";
import { join } from "path";
import fastifyStatic from "@fastify/static";
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, rmSync } from "fs";
import { homedir } from "os";
import {
  getPresetDir,
  readManifestFromDir,
  manifestToPresetFile,
  saveManifest,
  isPresetInstalled,
  extractPreset,
  HOME_DIR,
  extractMetadata,
  loadConfigFromManifest,
  downloadPresetToTemp,
  getTempDir,
  findMarketPresetByName,
  getMarketPresets,
  type PresetFile,
  type ManifestFile,
  type PresetMetadata,
} from "@CCR/shared";
import fastifyMultipart from "@fastify/multipart";
import AdmZip from "adm-zip";

export const createServer = async (config: any): Promise<any> => {
  const server = new Server(config);
  const app = server.app;

  app.register(fastifyMultipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    },
  });

  app.post("/v1/messages/count_tokens", async (req: any, reply: any) => {
    const {messages, tools, system, model} = req.body;
    const tokenizerService = (app as any)._server!.tokenizerService as TokenizerService;

    // If model is specified in "providerName,modelName" format, use the configured tokenizer
    if (model && model.includes(",") && tokenizerService) {
      try {
        const [provider, modelName] = model.split(",");
        req.log?.info(`Looking up tokenizer for provider: ${provider}, model: ${modelName}`);

        const tokenizerConfig = tokenizerService.getTokenizerConfigForModel(provider, modelName);

        if (!tokenizerConfig) {
          req.log?.warn(`No tokenizer config found for ${provider},${modelName}, using default tiktoken`);
        } else {
          req.log?.info(`Using tokenizer config: ${JSON.stringify(tokenizerConfig)}`);
        }

        const result = await tokenizerService.countTokens(
          { messages, system, tools },
          tokenizerConfig
        );

        return {
          "input_tokens": result.tokenCount,
          "tokenizer": result.tokenizerUsed,
        };
      } catch (error: any) {
        req.log?.error(`Error using configured tokenizer: ${error.message}`);
        req.log?.error(error.stack);
        // Fall back to default calculation
      }
    } else {
      if (!model) {
        req.log?.info(`No model specified, using default tiktoken`);
      } else if (!model.includes(",")) {
        req.log?.info(`Model "${model}" does not contain comma, using default tiktoken`);
      } else if (!tokenizerService) {
        req.log?.warn(`TokenizerService not available, using default tiktoken`);
      }
    }

    // Default to tiktoken calculation
    const tokenCount = calculateTokenCount(messages, system, tools);
    return { "input_tokens": tokenCount }
  });

  // Expose selectable model "profiles" to Claude Code's gateway model discovery
  // (CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1). The list is derived from the
  // "Profiles" block in config.json, so adding/removing a profile is JSON-only.
  // Each returned id is matched by data/custom-router.js to a per-profile routing
  // set. The choice is made per Claude Code instance via its native /model picker.
  app.get("/v1/models", async (req: any, reply: any) => {
    const ua = req.headers["user-agent"] || "unknown";
    console.log(`[GATEWAY-DISCOVERY] GET /v1/models - UA: ${ua}`);

    const config = await readConfigFile();
    const profiles = (config?.Profiles ?? {}) as Record<string, any>;
    const createdAt = new Date().toISOString();
    const capabilities = {
      thinking: { supported: true, types: { enabled: { supported: true }, adaptive: { supported: true } } },
      image_input: { supported: true },
      effort: { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true } },
      context_management: { supported: true },
      structured_outputs: { supported: true },
      code_execution: { supported: true },
      citations: { supported: true },
      batch: { supported: false },
    };
    const data = Object.entries(profiles).map(([id, profile]) => ({
      type: "model",
      id: `claude-code/${id}`,
      display_name: profile?.display_name ?? id,
      created_at: createdAt,
      capabilities,
    }));
    const body = {
      data,
      has_more: false,
      first_id: data[0]?.id ?? null,
      last_id: data[data.length - 1]?.id ?? null,
    };
    console.log(`[GATEWAY-DISCOVERY] response: ${data.length} models`);
    reply.type("application/json");
    return body;
  });

  // Add endpoint to read config.json with access control
  app.get("/api/config", async (req: any, reply: any) => {
    return await readConfigFile();
  });

  app.get("/api/transformers", async (req: any, reply: any) => {
    const transformers =
      (app as any)._server!.transformerService.getAllTransformers();
    const transformerList = Array.from(transformers.entries()).map(
      ([name, transformer]: any) => ({
        name,
        endpoint: transformer.endPoint || null,
      })
    );
    return { transformers: transformerList };
  });

  // Add endpoint to save config.json with access control
  app.post("/api/config", async (req: any, reply: any) => {
    const newConfig = req.body;

    // Backup existing config file if it exists
    const backupPath = await backupConfigFile();
    if (backupPath) {
      console.log(`Backed up existing configuration file to ${backupPath}`);
    }

    await writeConfigFile(newConfig);
    return { success: true, message: "Config saved successfully" };
  });

  // Register static file serving with caching
  app.register(fastifyStatic, {
    root: join(__dirname, "..", "dist"),
    prefix: "/ui/",
    maxAge: "1h",
  });

  // Redirect /ui to /ui/ for proper static file serving
  app.get("/ui", async (_: any, reply: any) => {
    return reply.redirect("/ui/");
  });

  // Get log file list endpoint
  app.get("/api/logs/files", async (req: any, reply: any) => {
    try {
      const logDir = join(homedir(), ".claude-code-router", "logs");
      const logFiles: Array<{ name: string; path: string; size: number; lastModified: string }> = [];

      if (existsSync(logDir)) {
        const files = readdirSync(logDir);

        for (const file of files) {
          if (file.endsWith('.log')) {
            const filePath = join(logDir, file);
            const stats = statSync(filePath);

            logFiles.push({
              name: file,
              path: filePath,
              size: stats.size,
              lastModified: stats.mtime.toISOString()
            });
          }
        }

        // Sort by modification time in descending order
        logFiles.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
      }

      return logFiles;
    } catch (error) {
      console.error("Failed to get log files:", error);
      reply.status(500).send({ error: "Failed to get log files" });
    }
  });

  // Get log content endpoint
  app.get("/api/logs", async (req: any, reply: any) => {
    try {
      const filePath = (req.query as any).file as string;
      let logFilePath: string;

      if (filePath) {
        // If file path is specified, use the specified path
        logFilePath = filePath;
      } else {
        // If file path is not specified, use default log file path
        logFilePath = join(homedir(), ".claude-code-router", "logs", "app.log");
      }

      if (!existsSync(logFilePath)) {
        return [];
      }

      const logContent = readFileSync(logFilePath, 'utf8');
      const logLines = logContent.split('\n').filter(line => line.trim())

      return logLines;
    } catch (error) {
      console.error("Failed to get logs:", error);
      reply.status(500).send({ error: "Failed to get logs" });
    }
  });

  // Clear log content endpoint
  app.delete("/api/logs", async (req: any, reply: any) => {
    try {
      const filePath = (req.query as any).file as string;
      let logFilePath: string;

      if (filePath) {
        // If file path is specified, use the specified path
        logFilePath = filePath;
      } else {
        // If file path is not specified, use default log file path
        logFilePath = join(homedir(), ".claude-code-router", "logs", "app.log");
      }

      if (existsSync(logFilePath)) {
        writeFileSync(logFilePath, '', 'utf8');
      }

      return { success: true, message: "Logs cleared successfully" };
    } catch (error) {
      console.error("Failed to clear logs:", error);
      reply.status(500).send({ error: "Failed to clear logs" });
    }
  });

  // Get presets list
  app.get("/api/presets", async (req: any, reply: any) => {
    try {
      const presetsDir = join(HOME_DIR, "presets");

      if (!existsSync(presetsDir)) {
        return { presets: [] };
      }

      const entries = readdirSync(presetsDir, { withFileTypes: true });
      const presetDirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);

      const presets: Array<PresetMetadata & { installed: boolean; id: string }> = [];

      for (const dirName of presetDirs) {
        const presetDir = join(presetsDir, dirName);
        try {
          const manifestPath = join(presetDir, "manifest.json");
          const content = readFileSync(manifestPath, 'utf-8');
          const manifest = JSON.parse(content);

          // Extract metadata fields
          const { Providers, Router, PORT, HOST, API_TIMEOUT_MS, PROXY_URL, LOG, LOG_LEVEL, StatusLine, NON_INTERACTIVE_MODE, ...metadata } = manifest;

          presets.push({
            id: dirName,  // Use directory name as unique identifier
            name: metadata.name || dirName,
            version: metadata.version || '1.0.0',
            description: metadata.description,
            author: metadata.author,
            homepage: metadata.homepage,
            repository: metadata.repository,
            license: metadata.license,
            keywords: metadata.keywords,
            ccrVersion: metadata.ccrVersion,
            source: metadata.source,
            sourceType: metadata.sourceType,
            checksum: metadata.checksum,
            installed: true,
          });
        } catch (error) {
          console.error(`Failed to read preset ${dirName}:`, error);
        }
      }

      return { presets };
    } catch (error) {
      console.error("Failed to get presets:", error);
      reply.status(500).send({ error: "Failed to get presets" });
    }
  });

  // Get preset details
  app.get("/api/presets/:name", async (req: any, reply: any) => {
    try {
      const { name } = req.params;
      const presetDir = getPresetDir(name);

      if (!existsSync(presetDir)) {
        reply.status(404).send({ error: "Preset not found" });
        return;
      }

      const manifest = await readManifestFromDir(presetDir);
      const presetFile = manifestToPresetFile(manifest);

      // Return preset info, config uses the applied userValues configuration
      return {
        ...presetFile,
        config: loadConfigFromManifest(manifest, presetDir),
        userValues: manifest.userValues || {},
      };
    } catch (error: any) {
      console.error("Failed to get preset:", error);
      reply.status(500).send({ error: error.message || "Failed to get preset" });
    }
  });

  // Apply preset (configure sensitive information)
  app.post("/api/presets/:name/apply", async (req: any, reply: any) => {
    try {
      const { name } = req.params;
      const { secrets } = req.body;

      const presetDir = getPresetDir(name);

      if (!existsSync(presetDir)) {
        reply.status(404).send({ error: "Preset not found" });
        return;
      }

      // Read existing manifest
      const manifest = await readManifestFromDir(presetDir);

      // Save user input to userValues (keep original config unchanged)
      const updatedManifest: ManifestFile = { ...manifest };

      // Save or update userValues
      if (secrets && Object.keys(secrets).length > 0) {
        updatedManifest.userValues = {
          ...updatedManifest.userValues,
          ...secrets,
        };
      }

      // Save updated manifest
      await saveManifest(name, updatedManifest);

      return { success: true, message: "Preset applied successfully" };
    } catch (error: any) {
      console.error("Failed to apply preset:", error);
      reply.status(500).send({ error: error.message || "Failed to apply preset" });
    }
  });

  // Delete preset
  app.delete("/api/presets/:name", async (req: any, reply: any) => {
    try {
      const { name } = req.params;
      const presetDir = getPresetDir(name);

      if (!existsSync(presetDir)) {
        reply.status(404).send({ error: "Preset not found" });
        return;
      }

      // Recursively delete entire directory
      rmSync(presetDir, { recursive: true, force: true });

      return { success: true, message: "Preset deleted successfully" };
    } catch (error: any) {
      console.error("Failed to delete preset:", error);
      reply.status(500).send({ error: error.message || "Failed to delete preset" });
    }
  });

  // Get preset market list
  app.get("/api/presets/market", async (req: any, reply: any) => {
    try {
      // Use market presets function
      const marketPresets = await getMarketPresets();
      return { presets: marketPresets };
    } catch (error: any) {
      console.error("Failed to get market presets:", error);
      reply.status(500).send({ error: error.message || "Failed to get market presets" });
    }
  });

  // Install preset from GitHub repository by preset name
  app.post("/api/presets/install/github", async (req: any, reply: any) => {
    try {
      const { presetName } = req.body;

      if (!presetName) {
        reply.status(400).send({ error: "Preset name is required" });
        return;
      }

      // Check if preset is in the marketplace
      const marketPreset = await findMarketPresetByName(presetName);
      if (!marketPreset) {
        reply.status(400).send({
          error: "Preset not found in marketplace",
          message: `Preset '${presetName}' is not available in the official marketplace. Please check the available presets.`
        });
        return;
      }

      // Get repository from market preset
      if (!marketPreset.repo) {
        reply.status(400).send({
          error: "Invalid preset data",
          message: `Preset '${presetName}' does not have repository information`
        });
        return;
      }

      // Parse GitHub repository URL
      const githubRepoMatch = marketPreset.repo.match(/(?:github\.com[:/]|^)([^/]+)\/([^/\s#]+?)(?:\.git)?$/);
      if (!githubRepoMatch) {
        reply.status(400).send({ error: "Invalid GitHub repository URL" });
        return;
      }

      const [, owner, repoName] = githubRepoMatch;

      // Use preset name from market
      const installedPresetName = marketPreset.name || presetName;

      // Check if already installed BEFORE downloading
      if (await isPresetInstalled(installedPresetName)) {
        reply.status(409).send({
          error: "Preset already installed",
          message: `Preset '${installedPresetName}' is already installed. To update or reconfigure, please delete it first using the delete button.`,
          presetName: installedPresetName
        });
        return;
      }

      // Download GitHub repository ZIP file
      const downloadUrl = `https://github.com/${owner}/${repoName}/archive/refs/heads/main.zip`;
      const tempFile = await downloadPresetToTemp(downloadUrl);

      // Load preset to validate structure
      const preset = await loadPresetFromZip(tempFile);

      // Double-check if already installed (in case of race condition)
      if (await isPresetInstalled(installedPresetName)) {
        unlinkSync(tempFile);
        reply.status(409).send({
          error: "Preset already installed",
          message: `Preset '${installedPresetName}' was installed while downloading. Please try again.`,
          presetName: installedPresetName
        });
        return;
      }

      // Extract to target directory
      const targetDir = getPresetDir(installedPresetName);
      await extractPreset(tempFile, targetDir);

      // Read manifest and add repo information
      const manifest = await readManifestFromDir(targetDir);

      // Add repo information to manifest from market data
      manifest.repository = marketPreset.repo;
      if (marketPreset.url) {
        manifest.source = marketPreset.url;
      }

      // Save updated manifest
      await saveManifest(installedPresetName, manifest);

      // Clean up temp file
      unlinkSync(tempFile);

      return {
        success: true,
        presetName: installedPresetName,
        preset: {
          ...preset.metadata,
          installed: true,
        }
      };
    } catch (error: any) {
      console.error("Failed to install preset from GitHub:", error);
      reply.status(500).send({ error: error.message || "Failed to install preset from GitHub" });
    }
  });

  app.get("/api/metrics", async (req: any, reply: any) => {
    const metricsPath = join(HOME_DIR, "metrics.jsonl");
    if (!existsSync(metricsPath)) {
      return { summary: [], raw_count: 0 };
    }
    const lines = readFileSync(metricsPath, "utf-8")
      .split("\n")
      .filter(Boolean);

    const buckets: Record<string, { count: number; errors: number; fallbacks: number; total_input: number; total_output: number; total_duration_ms: number; tok_per_sec_samples: number[] }> = {};
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        const key = `${e.provider},${e.model}`;
        if (!buckets[key]) {
          buckets[key] = { count: 0, errors: 0, fallbacks: 0, total_input: 0, total_output: 0, total_duration_ms: 0, tok_per_sec_samples: [] };
        }
        const b = buckets[key];
        b.count++;
        if (e.status >= 400) b.errors++;
        if (e.fallback) b.fallbacks++;
        b.total_input += e.input_tokens ?? 0;
        b.total_output += e.output_tokens ?? 0;
        b.total_duration_ms += e.duration_ms ?? 0;
        if (e.output_tok_per_sec > 0) b.tok_per_sec_samples.push(e.output_tok_per_sec);
      } catch {}
    }

    const summary = Object.entries(buckets).map(([key, b]) => {
      const [provider, ...modelParts] = key.split(",");
      const samples = b.tok_per_sec_samples;
      const avg_tok_per_sec = samples.length > 0
        ? Math.round((samples.reduce((a, c) => a + c, 0) / samples.length) * 10) / 10
        : 0;
      const p50_tok_per_sec = samples.length > 0
        ? (samples.sort((a, c) => a - c)[Math.floor(samples.length * 0.5)] ?? 0)
        : 0;
      return {
        provider,
        model: modelParts.join(","),
        count: b.count,
        errors: b.errors,
        fallbacks: b.fallbacks,
        avg_input_tokens: b.count > 0 ? Math.round(b.total_input / b.count) : 0,
        avg_output_tokens: b.count > 0 ? Math.round(b.total_output / b.count) : 0,
        avg_duration_ms: b.count > 0 ? Math.round(b.total_duration_ms / b.count) : 0,
        avg_output_tok_per_sec: avg_tok_per_sec,
        p50_output_tok_per_sec: Math.round(p50_tok_per_sec * 10) / 10,
      };
    }).sort((a, b) => b.count - a.count);

    return { summary, raw_count: lines.length };
  });

  app.delete("/api/metrics", async (req: any, reply: any) => {
    const metricsPath = join(HOME_DIR, "metrics.jsonl");
    if (existsSync(metricsPath)) {
      writeFileSync(metricsPath, "");
    }
    return { success: true };
  });

  app.get("/metrics", async (req: any, reply: any) => {
    const metricsPath = join(HOME_DIR, "metrics.jsonl");
    const buckets: Record<string, {
      requests_total: number; errors_total: number; fallbacks_total: number;
      input_tokens_total: number; output_tokens_total: number;
      duration_ms_total: number; tok_per_sec_sum: number; tok_per_sec_count: number;
      duration_buckets: number[];
    }> = {};
    const DURATION_BOUNDS = [500, 1000, 2000, 5000, 10000, 30000, 60000];

    if (existsSync(metricsPath)) {
      const lines = readFileSync(metricsPath, "utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          const key = `provider="${e.provider}",model="${e.model}"`;
          if (!buckets[key]) {
            buckets[key] = { requests_total: 0, errors_total: 0, fallbacks_total: 0, input_tokens_total: 0, output_tokens_total: 0, duration_ms_total: 0, tok_per_sec_sum: 0, tok_per_sec_count: 0, duration_buckets: new Array(DURATION_BOUNDS.length + 1).fill(0) };
          }
          const b = buckets[key];
          b.requests_total++;
          if (e.status >= 400) b.errors_total++;
          if (e.fallback) b.fallbacks_total++;
          b.input_tokens_total += e.input_tokens ?? 0;
          b.output_tokens_total += e.output_tokens ?? 0;
          b.duration_ms_total += e.duration_ms ?? 0;
          if (e.output_tok_per_sec > 0) { b.tok_per_sec_sum += e.output_tok_per_sec; b.tok_per_sec_count++; }
          const d = e.duration_ms ?? 0;
          for (let i = 0; i < DURATION_BOUNDS.length; i++) { if (d <= DURATION_BOUNDS[i]) b.duration_buckets[i]++; }
          b.duration_buckets[DURATION_BOUNDS.length]++;
        } catch {}
      }
    }

    const lines: string[] = [];
    const push = (s: string) => lines.push(s);

    push('# HELP ccr_requests_total Total LLM requests routed');
    push('# TYPE ccr_requests_total counter');
    for (const [labels, b] of Object.entries(buckets)) push(`ccr_requests_total{${labels}} ${b.requests_total}`);

    push('# HELP ccr_errors_total Requests that returned an error status');
    push('# TYPE ccr_errors_total counter');
    for (const [labels, b] of Object.entries(buckets)) push(`ccr_errors_total{${labels}} ${b.errors_total}`);

    push('# HELP ccr_fallbacks_total Requests served by a fallback model');
    push('# TYPE ccr_fallbacks_total counter');
    for (const [labels, b] of Object.entries(buckets)) push(`ccr_fallbacks_total{${labels}} ${b.fallbacks_total}`);

    push('# HELP ccr_input_tokens_total Total input tokens sent to provider');
    push('# TYPE ccr_input_tokens_total counter');
    for (const [labels, b] of Object.entries(buckets)) push(`ccr_input_tokens_total{${labels}} ${b.input_tokens_total}`);

    push('# HELP ccr_output_tokens_total Total output tokens received from provider');
    push('# TYPE ccr_output_tokens_total counter');
    for (const [labels, b] of Object.entries(buckets)) push(`ccr_output_tokens_total{${labels}} ${b.output_tokens_total}`);

    push('# HELP ccr_request_duration_ms_total Sum of request durations in milliseconds');
    push('# TYPE ccr_request_duration_ms_total counter');
    for (const [labels, b] of Object.entries(buckets)) push(`ccr_request_duration_ms_total{${labels}} ${b.duration_ms_total}`);

    push('# HELP ccr_output_tok_per_sec_avg Average output tokens per second (over requests with token data)');
    push('# TYPE ccr_output_tok_per_sec_avg gauge');
    for (const [labels, b] of Object.entries(buckets)) {
      const avg = b.tok_per_sec_count > 0 ? Math.round((b.tok_per_sec_sum / b.tok_per_sec_count) * 10) / 10 : 0;
      push(`ccr_output_tok_per_sec_avg{${labels}} ${avg}`);
    }

    push('# HELP ccr_request_duration_ms_bucket Request duration histogram in milliseconds');
    push('# TYPE ccr_request_duration_ms_bucket histogram');
    for (const [labels, b] of Object.entries(buckets)) {
      for (let i = 0; i < DURATION_BOUNDS.length; i++) push(`ccr_request_duration_ms_bucket{${labels},le="${DURATION_BOUNDS[i]}"} ${b.duration_buckets[i]}`);
      push(`ccr_request_duration_ms_bucket{${labels},le="+Inf"} ${b.duration_buckets[DURATION_BOUNDS.length]}`);
    }

    reply.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    reply.send(lines.join("\n") + "\n");
  });

  // Helper function: Load preset from ZIP
  async function loadPresetFromZip(zipFile: string): Promise<PresetFile> {
    const zip = new AdmZip(zipFile);

    // First try to find manifest.json in root directory
    let entry = zip.getEntry('manifest.json');

    // If not in root, try to find in subdirectories (handle GitHub repo archive structure)
    if (!entry) {
      const entries = zip.getEntries();
      // Find any manifest.json file
      entry = entries.find(e => e.entryName.includes('manifest.json')) || null;
    }

    if (!entry) {
      throw new Error('Invalid preset file: manifest.json not found');
    }

    const manifest = JSON.parse(entry.getData().toString('utf-8')) as ManifestFile;
    return manifestToPresetFile(manifest);
  }

  return server;
};
