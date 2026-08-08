import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

@Injectable()
export class CredentialEncryptionService {
  private key() {
    const configured = process.env.PLUGIN_CREDENTIALS_ENCRYPTION_KEY?.trim();
    if (!configured || configured.length < 32) {
      throw new Error('Plugin credential encryption is not configured');
    }
    return createHash('sha256').update(configured).digest();
  }

  encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64url'), authTag.toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  decrypt(value: string) {
    const [version, encodedIv, encodedTag, encodedCiphertext] = value.split('.');
    if (version !== VERSION || !encodedIv || !encodedTag || !encodedCiphertext) {
      throw new Error('Invalid encrypted plugin credential');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key(), Buffer.from(encodedIv, 'base64url'));
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
