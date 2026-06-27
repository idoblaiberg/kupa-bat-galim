import { GOOGLE_CLIENT_ID, ALLOWED_EMAILS } from './config.js';

const SS_TOKEN = 'kupa_token';
const SS_EMAIL = 'kupa_email';

let _tokenClient = null;
let _onReady = null;

function waitForGIS() {
  return new Promise(resolve => {
    const check = () => window.google?.accounts?.oauth2 ? resolve() : setTimeout(check, 50);
    check();
  });
}

export async function initAuth(onReady) {
  _onReady = onReady;
  await waitForGIS();

  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: 'email https://www.googleapis.com/auth/drive.readonly',
    callback: handleToken,
  });

  const stored = sessionStorage.getItem(SS_TOKEN);
  if (stored) {
    hideLogin();
    onReady(stored);
    return;
  }

  showLogin();
  document.getElementById('signInBtn').addEventListener('click', () => {
    document.getElementById('loginError').textContent = '';
    _tokenClient.requestAccessToken();
  });
}

async function handleToken(resp) {
  if (resp.error) { showError('התחברות נכשלה. נסו שוב.'); return; }
  try {
    const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${resp.access_token}` },
    }).then(r => r.json());

    if (!ALLOWED_EMAILS.includes(info.email)) {
      showError(`אין גישה לחשבון ${info.email}`);
      return;
    }

    sessionStorage.setItem(SS_TOKEN, resp.access_token);
    sessionStorage.setItem(SS_EMAIL, info.email);
    hideLogin();
    _onReady(resp.access_token);
  } catch {
    showError('שגיאה בבדיקת ההרשאות. נסו שוב.');
  }
}

export function getAccessToken() { return sessionStorage.getItem(SS_TOKEN); }
export function getUserEmail()   { return sessionStorage.getItem(SS_EMAIL); }

export function signOut() {
  const token = sessionStorage.getItem(SS_TOKEN);
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  sessionStorage.clear();
  localStorage.removeItem('kupa_cache');
  location.reload();
}

function showLogin() { document.getElementById('loginScreen').style.display = 'flex'; }
function hideLogin() { document.getElementById('loginScreen').style.display = 'none'; }
function showError(msg) { document.getElementById('loginError').textContent = msg; }
