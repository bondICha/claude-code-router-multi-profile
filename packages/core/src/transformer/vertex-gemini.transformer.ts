import { LLMProvider, UnifiedChatRequest } from "../types/llm";
import { Transformer } from "../types/transformer";
import {
  buildRequestBody,
  transformRequestOut,
  transformResponseOut,
} from "../utils/gemini.util";

async function getOAuthHeaders(): Promise<Record<string, string>> {
  try {
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    return { "Authorization": `Bearer ${accessToken.token || ''}` };
  } catch (error) {
    console.error('Error getting access token:', error);
    throw new Error('Vertex AI auth failed. Set GOOGLE_API_KEY (express mode) or GOOGLE_APPLICATION_CREDENTIALS (standard mode).');
  }
}

export class VertexGeminiTransformer implements Transformer {
  name = "vertex-gemini";

  async transformRequestIn(
    request: UnifiedChatRequest,
    provider: LLMProvider
  ): Promise<Record<string, any>> {
    const endpoint = request.stream ? "streamGenerateContent" : "generateContent";

    // Express mode: API key only, no project or location required.
    // Endpoint: https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent?key={key}
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_CLOUD_API_KEY;
    if (apiKey) {
      return {
        body: buildRequestBody(request),
        config: {
          url: new URL(
            `https://aiplatform.googleapis.com/v1/publishers/google/models/${request.model}:${endpoint}?key=${apiKey}`
          ),
          headers: {},
        },
      };
    }

    // Standard mode: project ID + OAuth2 service account credentials.
    let projectId = process.env.GOOGLE_CLOUD_PROJECT;
    const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

    if (!projectId && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      try {
        const fs = await import('fs');
        const keyContent = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
        const credentials = JSON.parse(keyContent);
        if (credentials?.project_id) {
          projectId = credentials.project_id;
        }
      } catch (error) {
        console.error('Error reading project_id from GOOGLE_APPLICATION_CREDENTIALS:', error);
      }
    }

    if (!projectId) {
      throw new Error(
        'Vertex AI requires either GOOGLE_API_KEY (express mode) or ' +
        'GOOGLE_CLOUD_PROJECT + GOOGLE_APPLICATION_CREDENTIALS (standard mode).'
      );
    }

    const authHeaders = await getOAuthHeaders();
    const base = provider.baseUrl.endsWith('/') ? provider.baseUrl : provider.baseUrl + '/';
    return {
      body: buildRequestBody(request),
      config: {
        url: new URL(
          `./v1/projects/${projectId}/locations/${location}/publishers/google/models/${request.model}:${endpoint}`,
          base
        ),
        headers: authHeaders,
      },
    };
  }

  async transformRequestOut(request: Record<string, any>): Promise<UnifiedChatRequest> {
    return transformRequestOut(request);
  }

  async transformResponseOut(response: Response): Promise<Response> {
    return transformResponseOut(response, this.name);
  }
}
