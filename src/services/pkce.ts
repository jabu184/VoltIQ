export const DEFAULT_TESLA_CLIENT_ID = '2dd7a3b6-3daa-4975-8234-1109615d4deb';
export const DEFAULT_TESLA_REDIRECT_URI = 'http://localhost:3001/api/auth/callback';

/**
 * Generates a random alphanumeric code verifier for PKCE (RFC 7636)
 */
export function generateCodeVerifier(length: number = 86): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let verifier = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    verifier += chars[randomIndex];
  }
  return verifier;
}

/**
 * Pure JavaScript SHA-256 implementation (works universally across Hermes, Web, and Node)
 */
export function sha256Bytes(ascii: string): Uint8Array {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i = 0,
    j = 0;

  const words: number[] = [];
  const asciiBitLength = ascii[lengthProperty] * 8;

  let hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;

  const isComposite: Record<number, boolean> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = true;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += '\x80';
  while ((ascii[lengthProperty] % 64) - 56) ascii += '\x00';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return new Uint8Array();
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength;

  for (j = 0; j < words[lengthProperty]; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);

    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15],
        w2 = w[i - 2];
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] =
        i < 16 ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0;

      const s1h = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const temp1 = (hash[7] + s1h + ch + k[i] + w[i]) | 0;
      const s0h = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const temp2 = (s0h + maj) | 0;

      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  const out = new Uint8Array(32);
  for (i = 0; i < 8; i++) {
    out[i * 4] = (hash[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (hash[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (hash[i] >>> 8) & 0xff;
    out[i * 4 + 3] = hash[i] & 0xff;
  }
  return out;
}

/**
 * Encodes a byte array to Base64URL string (RFC 7636)
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  let base64 = '';
  if (typeof btoa !== 'undefined') {
    base64 = btoa(binary);
  } else {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (let i = 0; i < binary.length; i += 3) {
      const b1 = binary.charCodeAt(i);
      const b2 = binary.charCodeAt(i + 1);
      const b3 = binary.charCodeAt(i + 2);
      base64 += chars[b1 >> 2];
      base64 += chars[((b1 & 3) << 4) | (b2 >> 4)];
      base64 += isNaN(b2) ? '=' : chars[((b2 & 15) << 2) | (b3 >> 6)];
      base64 += isNaN(b3) ? '=' : chars[b3 & 63];
    }
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Creates a code_challenge from a code_verifier using SHA-256
 */
export function generateCodeChallenge(codeVerifier: string): string {
  const hash = sha256Bytes(codeVerifier);
  return base64UrlEncode(hash);
}

/**
 * Builds the official Tesla OAuth authorize URL
 */
export function buildTeslaAuthUrl(
  codeChallenge: string,
  state: string = 'voltiq_oauth',
  clientId: string = DEFAULT_TESLA_CLIENT_ID,
  redirectUri: string = DEFAULT_TESLA_REDIRECT_URI
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid offline_access vehicle_device_data vehicle_charging_cmds',
    state,
  });
  return `https://auth.tesla.com/oauth2/v3/authorize?${params.toString()}`;
}

/**
 * Extracts authorization code from Tesla callback URL
 */
export function extractCodeFromCallbackUrl(url: string): string | null {
  try {
    if (!url) return null;
    const searchPart = url.includes('?') ? url.split('?')[1] : url;
    const params = new URLSearchParams(searchPart.split('#')[0]);
    return params.get('code');
  } catch {
    return null;
  }
}
