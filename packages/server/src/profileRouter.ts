/**
 * Built-in per-client model "profiles" router (logic only).
 *
 * This is the in-package replacement for the old data/custom-router.js. It is
 * shipped inside the server bundle (built to dist/profileRouter.js) and wired
 * up automatically by index.ts: when config.Profiles exists and the user has
 * not set their own CUSTOM_ROUTER_PATH, the path to this file is injected as
 * CUSTOM_ROUTER_PATH so the core router loads it via its existing require()
 * mechanism. Inputs (req.tokenCount, req.sessionId, full config) are therefore
 * identical to a hand-written custom router.
 *
 * The profile DATA (model mappings, display names) lives in config.json under
 * the "Profiles" block, plus "DefaultProfile". This file contains no model
 * names — it only decides which profile/scenario applies to a request and reads
 * the corresponding entry from config.Profiles.
 *
 * Each Claude Code instance picks a profile (e.g. glm / deepseek / mimo) from
 * its native /model picker. The selected id arrives in `req.body.model` on every
 * MAIN request, so the choice is per-client (per CC instance), not a global
 * server-wide setting. Everything is routed per profile:
 *   - default / think / longContext (+ longContextThreshold) / image : derived
 *     directly from the main request (it carries the profile id).
 *   - background : Claude Code sends these on a SEPARATE small/fast model slot
 *     (a Claude Haiku id), so the request does NOT carry the profile id. We map
 *     it back to the picked profile via the request's sessionId, which the core
 *     records on every main request (see below).
 *
 * Image handling: the global Router.image is intentionally unset in config.json,
 * which disables the built-in imageAgent (it bails when Router.image is falsy).
 * That lets us route image requests straight to the profile's image model.
 *
 * fallback: shared global `fallback`. The core forces scenarioType to 'default'
 * for every custom-router result (main AND background), so only `fallback.default`
 * applies to picker-routed requests; the other fallback.* lists are effectively
 * unused here.
 */

interface ProfileConfig {
  display_name?: string;
  default?: string;
  think?: string;
  longContext?: string;
  longContextThreshold?: number;
  image?: string;
  background?: string;
}

interface AppConfig {
  Profiles?: Record<string, ProfileConfig>;
  DefaultProfile?: string;
  [key: string]: any;
}

interface RouterRequest {
  body?: {
    model?: string;
    system?: any;
    messages?: any[];
    thinking?: unknown;
    [key: string]: any;
  };
  sessionId?: string;
  tokenCount?: number;
  [key: string]: any;
}

// sessionId -> last picked profile id. Lets background (Haiku) requests, which
// don't carry the profile id, be routed with the session's selected profile.
const sessionProfiles = new Map<string, string>();
const SESSION_CAP = 1000;

function rememberSessionProfile(sessionId: string | undefined, profileId: string): void {
  if (!sessionId) return;
  // Refresh recency (Map preserves insertion order).
  if (sessionProfiles.has(sessionId)) sessionProfiles.delete(sessionId);
  sessionProfiles.set(sessionId, profileId);
  if (sessionProfiles.size > SESSION_CAP) {
    const oldest = sessionProfiles.keys().next().value;
    if (oldest !== undefined) sessionProfiles.delete(oldest);
  }
}

function hasImageContent(messages: any[] | undefined): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some(
        (c: any) =>
          c.type === "image" ||
          (Array.isArray(c.content) &&
            c.content.some((sub: any) => sub.type === "image"))
      )
  );
}

async function profileRouter(
  req: RouterRequest,
  config: AppConfig
): Promise<string | null> {
  const profiles = (config && config.Profiles) || {};
  const defaultProfileId = (config && config.DefaultProfile) || "glm";
  const rawModel = (req.body && req.body.model) || "";
  const sessionId = req.sessionId;

  // Strip the claude-code/ prefix used in gateway model discovery (GET /v1/models).
  const modelId = rawModel.startsWith("claude-code/")
    ? rawModel.slice("claude-code/".length)
    : rawModel;

  // Explicit "provider,model" selection (e.g. /model volcengine,glm-5.1)
  // -> let the core router use it verbatim.
  if (rawModel.includes(",")) return null;

  // Subagent routing tag -> let the core router parse <CCR-SUBAGENT-MODEL>.
  const system = req.body && req.body.system;
  if (
    Array.isArray(system) &&
    system[1] &&
    typeof system[1].text === "string" &&
    system[1].text.startsWith("<CCR-SUBAGENT-MODEL>")
  ) {
    return null;
  }

  // Background slot: any Claude Haiku variant. The profile id is not on this
  // request, so recover it from the session (fall back to the default profile).
  // Use rawModel (not modelId) because haiku names are "claude-3-5-haiku-*".
  if (rawModel.includes("claude") && rawModel.includes("haiku")) {
    const bgProfile =
      profiles[sessionProfiles.get(sessionId || "") || defaultProfileId];
    return (bgProfile && bgProfile.background) || null;
  }

  // Main request: resolve the profile from the PICKED model id (after stripping
  // the claude-code/ gateway prefix). Fall back to the default profile for stock
  // claude-* aliases that don't match any profile key, and remember it for this
  // session so background tasks can be matched back.
  const profileId = profiles[modelId] ? modelId : defaultProfileId;
  const profile = profiles[profileId];
  if (!profile) return null; // No profiles configured -> let the core decide.
  rememberSessionProfile(sessionId, profileId);

  // Image -> profile's image model (imageAgent is disabled via empty Router.image).
  if (hasImageContent(req.body && req.body.messages) && profile.image) {
    return profile.image;
  }

  // Long context (per-profile threshold; req.tokenCount is set by the core).
  const threshold = profile.longContextThreshold || 80000;
  if ((req.tokenCount ?? 0) > threshold && profile.longContext) {
    return profile.longContext;
  }

  // Thinking / Plan mode.
  if (req.body && req.body.thinking && profile.think) {
    return profile.think;
  }

  return profile.default || null;
}

// Core loads this module via require(CUSTOM_ROUTER_PATH) and calls the result
// directly as a function, so the module's export must BE the function.
export = profileRouter;
