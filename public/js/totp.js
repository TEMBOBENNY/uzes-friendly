// totp.js — RFC 6238 TOTP for authenticator-app 2FA (Google Authenticator, Authy,
// Microsoft Authenticator, etc). Pure Web Crypto, no dependencies.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// 20 random bytes → base32 secret (the key shown/scanned into the authenticator app).
export function generateSecret(bytes = 20) {
  const rnd = new Uint8Array(bytes);
  crypto.getRandomValues(rnd);
  return base32Encode(rnd);
}

function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

async function hotp(secretBytes, counter) {
  const buf  = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey(
    "raw", secretBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
  const offset = sig[19] & 0xf;
  const code = ((sig[offset] & 0x7f) << 24) | (sig[offset + 1] << 16) |
               (sig[offset + 2] << 8) | sig[offset + 3];
  return (code % 1000000).toString().padStart(6, "0");
}

export async function totp(secretB32, time = Date.now(), step = 30) {
  return hotp(base32Decode(secretB32), Math.floor(time / 1000 / step));
}

// Verify a 6-digit token, allowing ±`window` 30-second steps for clock drift.
export async function verifyTOTP(secretB32, token, window = 1) {
  token = String(token).replace(/\s/g, "");
  if (!/^\d{6}$/.test(token)) return false;
  const bytes   = base32Decode(secretB32);
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    if (await hotp(bytes, counter + w) === token) return true;
  }
  return false;
}

// otpauth:// URI for the QR code.
export function otpauthURI(secretB32, account, issuer = "UZES") {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}` +
         `?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// Loads the qrcodejs library once (renders QR locally — the secret never leaves
// the browser). Resolves to the global QRCode constructor, or null on failure.
let _qrPromise = null;
export function loadQR() {
  if (window.QRCode) return Promise.resolve(window.QRCode);
  if (_qrPromise) return _qrPromise;
  _qrPromise = new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js";
    s.onload  = () => resolve(window.QRCode || null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return _qrPromise;
}
