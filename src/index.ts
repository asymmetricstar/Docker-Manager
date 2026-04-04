
/**
 * Levent INAN
 * Open-Source Docker SDK Project v1
 * 
*/

import http from 'http';
import net from 'net';
import fs from 'fs';
import { EventEmitter } from 'events';

/**
 * Basit YAML Parser - 3. Parti Kütüphane Olmadan
 */
class SimpleYaml {
  public static parse(content: string): any {
    const lines = content.split('\n');
    const result: any = {};
    let currentKey: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#')) continue;

      const indent = line.search(/\S/);
      if (trimmedLine.startsWith('-') && currentKey) {
        if (!Array.isArray(result[currentKey])) result[currentKey] = [];
        result[currentKey].push(trimmedLine.substring(1).trim());
        continue;
      }

      const colonIndex = trimmedLine.indexOf(':');
      if (colonIndex !== -1) {
        const key = trimmedLine.substring(0, colonIndex).trim();
        const value = trimmedLine.substring(colonIndex + 1).trim();
        
        if (value) {
          if (indent > 0 && currentKey) {
            if (typeof result[currentKey] !== 'object' || Array.isArray(result[currentKey])) result[currentKey] = {};
            result[currentKey][key] = value;
          } else {
            result[key] = value;
            currentKey = key;
          }
        } else {
          result[key] = null;
          currentKey = key;
        }
      }
    }
    return result;
  }
}

/**
 * Docker Engine API Client - Core Transport Layer
 */
class DockerClient {
  private socketPath: string;

  constructor(socketPath?: string) {
    if (socketPath) {
      this.socketPath = socketPath;
    } else {
      this.socketPath = process.platform === 'win32' 
        ? '//./pipe/docker_engine' 
        : '/var/run/docker.sock';
    }
  }

  public async request<T>(options: {
    path: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: any;
    headers?: Record<string, string>;
  }, emitter?: EventEmitter): Promise<T | null> {
    const { path, method = 'GET', body, headers = {} } = options;

    const requestOptions: http.RequestOptions = {
      socketPath: this.socketPath,
      path: `/v1.43${path}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      } as http.OutgoingHttpHeaders,
    };

    if (body !== undefined && body !== null) {
      try {
        const bodyData = JSON.stringify(body);
        (requestOptions.headers as any)['Content-Length'] = Buffer.byteLength(bodyData);
      } catch (err: any) {
        emitter?.emit('error', new Error(`Body JSON Hatası: ${err.message}`));
        return null;
      }
    }

    // Komut logunu fırlat
    emitter?.emit('command', {
      method,
      path: requestOptions.path,
      body: body || null,
      timestamp: new Date().toISOString()
    });

    return new Promise((resolve) => {
      const req = http.request(requestOptions, (res) => {
        let responseData = '';
        res.on('data', (chunk) => responseData += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(responseData ? JSON.parse(responseData) : ({} as T));
            } catch (err) {
              resolve(responseData as any);
            }
          } else {
            const error = new Error(`Docker API Hatası (${res.statusCode}): ${responseData || res.statusMessage}`);
            emitter?.emit('error', error);
            resolve(null);
          }
        });
      });

      req.on('error', (err) => {
        emitter?.emit('error', new Error(`Docker Soket Hatası: ${err.message}`));
        resolve(null);
      });

      if (body !== undefined && body !== null) req.write(JSON.stringify(body));
      req.end();
    });
  }

  public async ping(): Promise<boolean> {
    try {
      const response = await this.request<string>({ path: '/_ping', method: 'GET' });
      return response === 'OK';
    } catch {
      return false;
    }
  }
}

/**
 * Konteyner Modülü
 */
class ContainerModule {
  constructor(private client: DockerClient, private emitter: EventEmitter) {}
  /**
   * Mevcut konteynerleri listeler.
   */
  public async list(options: { all?: boolean; limit?: number; size?: boolean; filters?: Record<string, string | string[]> } = {}): Promise<any[]> {
    const queryParams = new URLSearchParams();
    if (options?.all) queryParams.append('all', 'true');
    if (options?.limit) queryParams.append('limit', options.limit.toString());
    if (options?.size) queryParams.append('size', 'true');
    if (options?.filters) queryParams.append('filters', this.transformFilters(options.filters));

    const path = `/containers/json${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const result = await this.client.request<any[]>({ path }, this.emitter);
    return result || [];
  }

  /**
   * Filtre nesnesini Docker API'sinin beklediği JSON formatına çevirir.
   */
  private transformFilters(filters: Record<string, string | string[]>): string {
    const formatted: Record<string, string[]> = {};
    Object.entries(filters).forEach(([key, value]) => {
      formatted[key] = Array.isArray(value) ? value : [value];
    });
    return JSON.stringify(formatted);
  }

  public async create(name: string | null, config: any): Promise<{ Id: string; Warnings: string[] } | null> {
    const apiConfig = this.transformConfig(config);
    const path = `/containers/create${name ? `?name=${name}` : ''}`;
    return await this.client.request<{ Id: string; Warnings: string[] }>({ 
      path, method: 'POST', body: apiConfig 
    }, this.emitter);
  }

  private transformConfig(input: any): any {
    if (input.Image || input.image === undefined) return input;
    const config: any = {
      Image: input.image,
      Env: input.env ? (Array.isArray(input.env) ? input.env : Object.entries(input.env).map(([k, v]) => `${k}=${v}`)) : [],
      ExposedPorts: {},
      HostConfig: {
        PortBindings: {},
        Binds: input.volumes || [],
        RestartPolicy: { Name: input.restart || 'no' }
      }
    };
    if (input.ports && Array.isArray(input.ports)) {
      input.ports.forEach((p: string) => {
        const [host, container] = p.split(':');
        const cPort = container.includes('/') ? container : `${container}/tcp`;
        config.ExposedPorts[cPort] = {};
        config.HostConfig.PortBindings[cPort] = [{ HostPort: host }];
      });
    }
    return config;
  }

  public async start(id: string): Promise<boolean> {
    const res = await this.client.request({ path: `/containers/${id}/start`, method: 'POST' }, this.emitter);
    return res !== null;
  }

  public async stop(id: string, t?: number): Promise<boolean> {
    const res = await this.client.request({ path: `/containers/${id}/stop${t ? `?t=${t}` : ''}`, method: 'POST' }, this.emitter);
    return res !== null;
  }

  public async restart(id: string, t?: number): Promise<boolean> {
    const res = await this.client.request({ path: `/containers/${id}/restart${t ? `?t=${t}` : ''}`, method: 'POST' }, this.emitter);
    return res !== null;
  }

  public async remove(id: string, opts: any = {}): Promise<boolean> {
    const q = new URLSearchParams();
    if (opts.v) q.append('v', 'true');
    if (opts.force) q.append('force', 'true');
    const res = await this.client.request({ path: `/containers/${id}?${q.toString()}`, method: 'DELETE' }, this.emitter);
    return res !== null;
  }

  public async inspect(id: string): Promise<any> {
    return await this.client.request({ path: `/containers/${id}/json` }, this.emitter);
  }

  public async logs(id: string, opts: any = {}): Promise<string> {
    const q = new URLSearchParams();
    q.append('stdout', (opts.stdout !== false).toString());
    q.append('stderr', (opts.stderr !== false).toString());
    q.append('tail', opts.tail?.toString() || 'all');
    const raw = await this.client.request<string>({ path: `/containers/${id}/logs?${q.toString()}` }, this.emitter);
    if (!raw || typeof raw !== 'string') return '';
    let clean = '';
    const buf = Buffer.from(raw, 'binary');
    let off = 0;
    while (off + 8 <= buf.length) {
      const size = buf.readUInt32BE(off + 4);
      clean += buf.subarray(off + 8, Math.min(off + 8 + size, buf.length)).toString('utf8');
      off += 8 + size;
    }
    return clean || raw;
  }
}

/**
 * İmaj Modülü
 */
class ImageModule {
  constructor(private client: DockerClient, private emitter: EventEmitter) {}
  public async list(): Promise<any[]> {
    const res = await this.client.request<any[]>({ path: '/images/json' }, this.emitter);
    return res || [];
  }
  public async pull(name: string): Promise<boolean> {
    const [img, tag = 'latest'] = name.split(':');
    const res = await this.client.request({ path: `/images/create?fromImage=${img}&tag=${tag}`, method: 'POST' }, this.emitter);
    return res !== null;
  }
  public async search(t: string, l: number = 25): Promise<any[]> {
    const res = await this.client.request<any[]>({ path: `/images/search?term=${t}&limit=${l}` }, this.emitter);
    return res || [];
  }
  public async remove(id: string, f: boolean = false): Promise<boolean> {
    const res = await this.client.request({ path: `/images/${id}${f ? '?force=true' : ''}`, method: 'DELETE' }, this.emitter);
    return res !== null;
  }
}

/**
 * Ağ Modülü
 */
class NetworkModule {
  constructor(private client: DockerClient, private emitter: EventEmitter) {}
  public async list(): Promise<any[]> {
    const res = await this.client.request<any[]>({ path: '/networks' }, this.emitter);
    return res || [];
  }
  public async create(name: string, config: any = {}): Promise<any> {
    const body: any = { Name: name, Driver: config.driver || 'bridge' };
    if (config.subnet) body.IPAM = { Config: [{ Subnet: config.subnet, Gateway: config.gateway }] };
    return await this.client.request({ path: '/networks/create', method: 'POST', body }, this.emitter);
  }
  public async connect(n: string, c: string): Promise<boolean> {
    const res = await this.client.request({ path: `/networks/${n}/connect`, method: 'POST', body: { Container: c } }, this.emitter);
    return res !== null;
  }
  public async disconnect(n: string, c: string): Promise<boolean> {
    const res = await this.client.request({ path: `/networks/${n}/disconnect`, method: 'POST', body: { Container: c } }, this.emitter);
    return res !== null;
  }
  public async remove(id: string): Promise<boolean> {
    const res = await this.client.request({ path: `/networks/${id}`, method: 'DELETE' }, this.emitter);
    return res !== null;
  }
}

/**
 * Birim Modülü
 */
class VolumeModule {
  constructor(private client: DockerClient, private emitter: EventEmitter) {}
  public async list(): Promise<any> {
    return await this.client.request({ path: '/volumes' }, this.emitter);
  }
  public async create(name?: string, config: any = {}): Promise<any> {
    const body: any = { Name: name, DriverOpts: {} };
    if (config.type === 'tmpfs') {
      body.DriverOpts = { type: 'tmpfs', device: 'tmpfs', o: `size=${config.size || '64m'}` };
    } else if (config.size) {
      body.DriverOpts.size = config.size;
    }
    return await this.client.request({ path: '/volumes/create', method: 'POST', body }, this.emitter);
  }
  public async remove(n: string, f: boolean = false): Promise<boolean> {
    const res = await this.client.request({ path: `/volumes/${n}${f ? '?force=true' : ''}`, method: 'DELETE' }, this.emitter);
    return res !== null;
  }
  public async prune(): Promise<any> {
    return await this.client.request({ path: '/volumes/prune', method: 'POST' }, this.emitter);
  }
}

/**
 * Docker Manager Yapılandırma Seçenekleri
 */
export interface DockerOptions {
  socketPath?: string;
  config?: {
    ping?: number | string; // Saniye cinsinden ping aralığı
  };
}

/**
 * Ana Docker Yöneticisi (Docker Manager)
 * EventEmitter miras alır, olay tabanlı hata ve durum yönetimi sağlar.
 */
export class DockerManager extends EventEmitter {
  public client: DockerClient;
  public containers: ContainerModule;
  public images: ImageModule;
  public networks: NetworkModule;
  public volumes: VolumeModule;
  
  private isConnected: boolean = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private options: DockerOptions;

  constructor(options: DockerOptions = {}) {
    super();
    this.options = options;
    this.client = new DockerClient(options.socketPath);
    this.containers = new ContainerModule(this.client, this);
    this.images = new ImageModule(this.client, this);
    this.networks = new NetworkModule(this.client, this);
    this.volumes = new VolumeModule(this.client, this);

    this.startHealthCheck();
  }

  /**
   * Arka planda Docker bağlantısını sürekli denetler.
   */
  private startHealthCheck() {
    const check = async () => {
      const active = await this.client.ping();
      if (active !== this.isConnected) {
        this.isConnected = active;
        this.emit('health', active);
        this.emit(active ? 'connected' : 'disconnected');
      }
    };
    
    check(); // İlk kontrol
    
    // Ping süresini belirle (Varsayılan 5 saniye)
    const pingSeconds = parseInt(this.options.config?.ping?.toString() || '5');
    const intervalMs = Math.max(pingSeconds, 1) * 1000; // En az 1 saniye
    
    this.checkInterval = setInterval(check, intervalMs);
  }

  /**
   * Bağlantı durumunu döner.
   */
  public getStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Kaynakları temizler ve takibi durdurur.
   */
  public destroy() {
    if (this.checkInterval) clearInterval(this.checkInterval);
    this.removeAllListeners();
  }

  /**
   * YAML/JSON Dağıtımı
   */
  public async deploy(filePath: string, name: string | null = null): Promise<any> {
    if (!fs.existsSync(filePath)) {
      this.emit('error', new Error(`Dosya bulunamadı: ${filePath}`));
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const config = filePath.endsWith('.json') ? JSON.parse(content) : SimpleYaml.parse(content);
    const container = await this.containers.create(name, config);
    if (container) await this.containers.start(container.Id);
    return container;
  }
}
