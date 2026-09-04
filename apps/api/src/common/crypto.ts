import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function key(): Buffer {
  const value = process.env.ENCRYPTION_KEY;
  if (!value) throw new Error('ENCRYPTION_KEY is required');
  const buffer = Buffer.from(value, 'hex');
  if (buffer.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes in hex');
  return buffer;
}

export function encryptCredentials(credentials: Record<string, string>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function decryptCredentials(value: string): Record<string, string> {
  const data = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(),
  ) as Record<string, string>;
}
