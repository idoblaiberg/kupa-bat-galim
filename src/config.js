export const GOOGLE_CLIENT_ID = '601430234123-o0kr8q8s2sr2uiv9p1dvlo9anrmvp7vl.apps.googleusercontent.com';

export const ALLOWED_EMAILS = [
  'blaiberg.ido@gmail.com',
  'windpointbg@gmail.com',
  'ysbyamit@gmail.com',
];

// Admins see the Settings gear and can repoint the app at a different file (on their own device).
// Everyone else just loads the file baked into DRIVE below — no settings, no setup.
export const ADMIN_EMAILS = [
  'blaiberg.ido@gmail.com',
];

// Google Drive IDs — safe to commit; Drive rejects requests without a valid OAuth token
export const DRIVE = {
  // Stock is an uploaded Excel (.xlsx) file — downloaded as binary and parsed in-browser
  // (Drive can't CSV-export uploaded Office files, only native Sheets).
  stockFileId: '1RN2zCBW9oGz9fr0L9F4bUA5Qc93JbmG-',
  pricesFileId: '19DvaQHvMKmCz8rN6Wt3jqK5jnPNrKmbT',
};
