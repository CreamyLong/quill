import { getBackendBaseURL } from "../config";
import { isStaticWebsiteOnly } from "../static-mode";

import type { ModelsResponse, ProvidersResponse } from "./types";

const STATIC_MODELS_RESPONSE: ModelsResponse = {
  models: [],
  token_usage: { enabled: false },
};

export async function loadModels(): Promise<ModelsResponse> {
  if (isStaticWebsiteOnly()) {
    return STATIC_MODELS_RESPONSE;
  }

  const res = await fetch(`${getBackendBaseURL()}/api/models`);
  const data = (await res.json()) as Partial<ModelsResponse>;
  return {
    models: data.models ?? [],
    token_usage: data.token_usage ?? { enabled: false },
  };
}

const STATIC_PROVIDERS_RESPONSE: ProvidersResponse = {
  providers: [],
};

export async function loadProviders(): Promise<ProvidersResponse> {
  if (isStaticWebsiteOnly()) {
    return STATIC_PROVIDERS_RESPONSE;
  }

  const res = await fetch(`${getBackendBaseURL()}/api/models/providers`);
  if (!res.ok) {
    return STATIC_PROVIDERS_RESPONSE;
  }
  const data = (await res.json()) as Partial<ProvidersResponse>;
  return {
    providers: data.providers ?? [],
  };
}
