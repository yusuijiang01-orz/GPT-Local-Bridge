// OAuth POC placeholder.
// This module intentionally does not implement browser cookie extraction
// or ChatGPT web session reuse.
//
// Future implementation must use an officially supported OAuth flow.

export function createOAuthSession(config = {}) {
  return {
    status: 'NOT_CONFIGURED',
    provider: config.provider || 'openai',
    message: 'OAuth client registration and supported scopes must be verified first.'
  };
}

export function buildAuthorizationRequest() {
  throw new Error('OAuth authorization endpoint is not configured.');
}
