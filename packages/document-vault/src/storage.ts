import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { connect } from 'node:net';
import type { MalwareScanner, MalwareScanStatus } from './vault';

/**
 * Document storage adapters.
 *
 * - LocalFileStorage: development/test ONLY (loadAppConfig forbids the `local`
 *   provider in stage/prod).
 * - SupabaseStorageAdapter: Supabase Storage HTTP API with the tenant's own
 *   service key (server-side only; encryption at rest is provider-managed).
 * - S3CompatibleStorage: AWS Signature V4 against any S3-compatible endpoint
 *   (AWS, MinIO, municipal object storage) with SSE requested per object.
 */

export interface DocumentStorage {
  readonly provider: 'local' | 'supabase' | 's3';
  put(path: string, content: Uint8Array, contentType: string): Promise<void>;
  get(path: string): Promise<Uint8Array>;
  delete(path: string): Promise<void>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'unauthorized' | 'io_error' | 'invalid_path',
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

function assertSafePath(path: string): void {
  const normalized = normalize(path);
  if (
    normalized.startsWith('..') ||
    normalized.includes(`..${sep}`) ||
    normalized.startsWith(sep)
  ) {
    throw new StorageError(`Unsafe storage path: ${path}`, 'invalid_path');
  }
}

export class LocalFileStorage implements DocumentStorage {
  readonly provider = 'local' as const;
  constructor(private readonly rootDir: string) {}

  async put(path: string, content: Uint8Array): Promise<void> {
    assertSafePath(path);
    const full = join(this.rootDir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }

  async get(path: string): Promise<Uint8Array> {
    assertSafePath(path);
    try {
      return await readFile(join(this.rootDir, path));
    } catch {
      throw new StorageError(`Object not found: ${path}`, 'not_found');
    }
  }

  async delete(path: string): Promise<void> {
    assertSafePath(path);
    await rm(join(this.rootDir, path), { force: true });
  }
}

export interface SupabaseStorageOptions {
  url: string;
  serviceKey: string;
  bucket: string;
  fetchImpl?: typeof fetch;
}

export class SupabaseStorageAdapter implements DocumentStorage {
  readonly provider = 'supabase' as const;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: SupabaseStorageOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private objectUrl(path: string): string {
    return `${this.options.url.replace(/\/$/, '')}/storage/v1/object/${this.options.bucket}/${path}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      authorization: `Bearer ${this.options.serviceKey}`,
      apikey: this.options.serviceKey,
      ...extra,
    };
  }

  async put(path: string, content: Uint8Array, contentType: string): Promise<void> {
    assertSafePath(path);
    const response = await this.fetchImpl(this.objectUrl(path), {
      method: 'POST',
      headers: this.headers({ 'content-type': contentType, 'x-upsert': 'true' }),
      body: Buffer.from(content),
    });
    if (!response.ok) {
      throw new StorageError(
        `Supabase Storage upload failed (${response.status})`,
        response.status === 401 || response.status === 403 ? 'unauthorized' : 'io_error',
      );
    }
  }

  async get(path: string): Promise<Uint8Array> {
    assertSafePath(path);
    const response = await this.fetchImpl(this.objectUrl(path), { headers: this.headers() });
    if (response.status === 404) throw new StorageError(`Object not found: ${path}`, 'not_found');
    if (!response.ok)
      throw new StorageError(`Supabase Storage read failed (${response.status})`, 'io_error');
    return new Uint8Array(await response.arrayBuffer());
  }

  async delete(path: string): Promise<void> {
    assertSafePath(path);
    const response = await this.fetchImpl(this.objectUrl(path), {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!response.ok && response.status !== 404) {
      throw new StorageError(`Supabase Storage delete failed (${response.status})`, 'io_error');
    }
  }
}

export interface S3StorageOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Request server-side encryption per object (AES256). */
  serverSideEncryption?: boolean;
  fetchImpl?: typeof fetch;
}

/** Minimal AWS Signature V4 signer for S3-compatible object storage. */
export class S3CompatibleStorage implements DocumentStorage {
  readonly provider = 's3' as const;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: S3StorageOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request(
    method: 'PUT' | 'GET' | 'DELETE',
    path: string,
    body?: Uint8Array,
    contentType?: string,
  ): Promise<Response> {
    assertSafePath(path);
    const url = new URL(
      `${this.options.endpoint.replace(/\/$/, '')}/${this.options.bucket}/${path}`,
    );
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash('sha256')
      .update(body ?? Buffer.alloc(0))
      .digest('hex');

    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (contentType) headers['content-type'] = contentType;
    if (method === 'PUT' && this.options.serverSideEncryption !== false) {
      headers['x-amz-server-side-encryption'] = 'AES256';
    }

    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join('');
    const signedHeaders = signedHeaderNames.join(';');
    const canonicalRequest = [
      method,
      url.pathname,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const scope = `${dateStamp}/${this.options.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const hmac = (key: Buffer | string, data: string) =>
      createHmac('sha256', key).update(data).digest();
    const kDate = hmac(`AWS4${this.options.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.options.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    headers['authorization'] =
      `AWS4-HMAC-SHA256 Credential=${this.options.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const { host: _host, ...sendHeaders } = headers;
    return this.fetchImpl(url.toString(), {
      method,
      headers: sendHeaders,
      ...(body ? { body: Buffer.from(body) } : {}),
    });
  }

  async put(path: string, content: Uint8Array, contentType: string): Promise<void> {
    const response = await this.request('PUT', path, content, contentType);
    if (!response.ok) throw new StorageError(`S3 upload failed (${response.status})`, 'io_error');
  }

  async get(path: string): Promise<Uint8Array> {
    const response = await this.request('GET', path);
    if (response.status === 404) throw new StorageError(`Object not found: ${path}`, 'not_found');
    if (!response.ok) throw new StorageError(`S3 read failed (${response.status})`, 'io_error');
    return new Uint8Array(await response.arrayBuffer());
  }

  async delete(path: string): Promise<void> {
    const response = await this.request('DELETE', path);
    if (!response.ok && response.status !== 404) {
      throw new StorageError(`S3 delete failed (${response.status})`, 'io_error');
    }
  }
}

// --- Malware scanners ----------------------------------------------------------

/** ClamAV clamd INSTREAM scanner (TCP). */
export class ClamAvScanner implements MalwareScanner {
  constructor(
    private readonly host: string,
    private readonly port = 3310,
    private readonly timeoutMs = 30_000,
  ) {}

  async scan(content: Uint8Array): Promise<MalwareScanStatus> {
    return new Promise<MalwareScanStatus>((resolve) => {
      const socket = connect({ host: this.host, port: this.port });
      let response = '';
      const timer = setTimeout(() => {
        socket.destroy();
        resolve('scan_failed');
      }, this.timeoutMs);

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        const size = Buffer.alloc(4);
        size.writeUInt32BE(content.byteLength);
        socket.write(size);
        socket.write(Buffer.from(content));
        const end = Buffer.alloc(4);
        end.writeUInt32BE(0);
        socket.write(end);
      });
      socket.on('data', (chunk) => {
        response += chunk.toString('utf8');
      });
      socket.on('end', () => {
        clearTimeout(timer);
        if (/\bOK\b/.test(response)) resolve('clean');
        else if (/FOUND/.test(response)) resolve('infected');
        else resolve('scan_failed');
      });
      socket.on('error', () => {
        clearTimeout(timer);
        resolve('scan_failed');
      });
    });
  }
}

/** External scanning API: POST the file, receive { verdict: "clean" | "infected" }. */
export class ExternalApiScanner implements MalwareScanner {
  constructor(
    private readonly endpoint: string,
    private readonly apiKeyRef?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async scan(content: Uint8Array, fileName: string): Promise<MalwareScanStatus> {
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-file-name': fileName,
          ...(this.apiKeyRef ? { authorization: `Bearer ${this.apiKeyRef}` } : {}),
        },
        body: Buffer.from(content),
      });
      if (!response.ok) return 'scan_failed';
      const result = (await response.json()) as { verdict?: string };
      if (result.verdict === 'clean') return 'clean';
      if (result.verdict === 'infected') return 'infected';
      return 'scan_failed';
    } catch {
      return 'scan_failed';
    }
  }
}
