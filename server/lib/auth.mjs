import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
    scrypt as scryptCallback,
    timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export function sha256(value) {
    return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export async function hashPassword(password) {
    const salt = randomBytes(16);
    const derived = await scrypt(String(password), salt, 64);
    return `scrypt$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
    const [algorithm, saltText, expectedText] = String(encoded ?? '').split('$');
    if (algorithm !== 'scrypt' || !saltText || !expectedText) return false;
    const expected = Buffer.from(expectedText, 'base64url');
    const actual = Buffer.from(await scrypt(String(password), Buffer.from(saltText, 'base64url'), expected.length));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function encryptionKey(secret) {
    return createHash('sha256').update(String(secret), 'utf8').digest();
}

export function encryptSecret(value, secret) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
    const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decryptSecret(value, secret) {
    const [ivText, tagText, ciphertextText] = String(value ?? '').split('.');
    if (!ivText || !tagText || !ciphertextText) throw new Error('Invalid encrypted secret');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString(
        'utf8'
    );
}

export function randomToken(bytes = 32) {
    return randomBytes(bytes).toString('base64url');
}

export function parseCookies(header) {
    const cookies = {};
    for (const part of String(header ?? '').split(';')) {
        const index = part.indexOf('=');
        if (index <= 0) continue;
        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        try {
            cookies[key] = decodeURIComponent(value);
        } catch {
            cookies[key] = value;
        }
    }
    return cookies;
}
