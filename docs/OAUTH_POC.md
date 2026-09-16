# GPT Local Bridge OAuth POC

## Goal

Validate whether a desktop Electron application can use an official OpenAI OAuth flow for user authorization.

This POC does not read browser cookies, reuse ChatGPT web sessions, or extract private tokens.

## Flow

1. User clicks `Sign in with OpenAI` in Electron.
2. Electron opens the system browser authorization page.
3. User completes authorization.
4. Browser redirects to `gptlocalbridge://callback`.
5. Electron captures the callback and stores only supported credentials using OS secure storage.

## Validation questions

- Is an official OAuth client registration available?
- Which scopes are available for third-party desktop applications?
- Can the resulting credential call the required model APIs?

## Fallback

If ChatGPT account OAuth is unavailable for third-party desktop apps, the architecture should switch to provider login with API keys while keeping the same Auth Manager interface.
