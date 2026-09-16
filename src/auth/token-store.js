// Token storage abstraction for OAuth POC.
// Do not store access or refresh tokens in config.json or localStorage.

export async function saveCredential() {
  throw new Error('Secure OS credential storage is not implemented yet.');
}

export async function loadCredential() {
  return null;
}

export async function removeCredential() {
  return false;
}
