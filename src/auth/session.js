const session = {
  authenticated: false,
  account: null
};

export function getAuthSession() {
  return { ...session };
}

export function clearAuthSession() {
  session.authenticated = false;
  session.account = null;
}
