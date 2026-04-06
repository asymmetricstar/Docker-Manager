# Docker Management SDK (Professional Zero-Dependency Interface)

This library is a high-performance, modular Node.js/TypeScript interface designed to communicate directly with the Docker Engine API. Built with a **Zero-Dependency** philosophy, it uses only built-in Node.js modules (`http`, `net`, `fs`).

## 🏗️ Architecture
The system provides a simplified abstraction layer over Docker's complex low-level API. All modules operate through a central `DockerClient`, ensuring secure, robust, and asynchronous communication.


## 📦 Npm Install : ```npm npm i @asymmetricstar/docker-manager ```

## 🚀 Getting Started & Configuration

You can customize the heartbeat (ping) interval and the socket path during initialization.

```typescript
import { DockerManager } from "@asymmetricstar/docker-manager"

// Custom Configuration
const manager = new DockerManager({
  socketPath: process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock',
  config: {
    ping: 5 // Perform connection check every 5 seconds (Heartbeat)
  }
});

// Initialize with default values
// const manager = new DockerManager();
```

## 🛡️ Event-Driven Management & Error Handling

The library extends the `EventEmitter` class, allowing you to use centralized listeners instead of repetitive `try-catch` blocks.

### Connection and Audit Monitoring
The system continuously monitors the Docker connection in the background.

```typescript
const manager = new DockerManager();

// Capture errors globally
manager.on('error', (err) => {
  console.error("Docker Error:", err.message);
});

// Monitor connection status
manager.on('connected', () => console.log("Docker Connected ✅"));
manager.on('disconnected', () => console.log("Docker Disconnected ❌"));

// Monitor API calls (Audit Log)
manager.on('command', (cmd) => {
  console.log(`[${cmd.timestamp}] ${cmd.method} ${cmd.path}`);
  if (cmd.body) console.log("Payload:", cmd.body);
});

// Query current status
const isLive = manager.getStatus();
```

---

## 📦 1. Container Management (`manager.containers`)

The primary module for managing the full lifecycle of Docker containers.

### List Containers (`list`)
Retrieves containers with optional filtering.

**Available Filters:**
- `status`: created, restarting, running, removing, paused, exited, dead
- `name`: Container name
- `id`: Container ID
- `ancestor`: Image name or ID
- `label`: "key" or "key=value"
- `network`: Network name or ID

```typescript
// Example: Get only running containers named "web"
const containers = await manager.containers.list({
  filters: {
    status: 'running',
    name: 'web'
  }
});
```

### Create Container (`create`)
Creates a new container. Automatically transforms simplified formats into Docker API schemas.
```typescript
const config = {
  image: 'nginx:latest',
  ports: ['8080:80'],           // Host:Container mapping
  env: { MODE: 'production' },  // Key-Value object
  volumes: ['/my/data:/data'],  // Volume mounts
  restart: 'always'             // Policy: no, always, on-failure
};
const result = await manager.containers.create('web-server', config);
```

### Lifecycle Control
```typescript
await manager.containers.start('web-server');
await manager.containers.stop('web-server', 10); // 10-second timeout
await manager.containers.restart('web-server');
```

### Logs (`logs`)
Parses Docker's binary multiplexed stream and returns clean text.
```typescript
const logs = await manager.containers.logs('web-server', { 
  tail: 100, 
  timestamps: true 
});
```

### Inspect (`inspect`)
Returns raw data including IP addresses, port maps, and state information.
```typescript
const info = await manager.containers.inspect('web-server');
```

### Remove (`remove`)
```typescript
await manager.containers.remove('web-server', { force: true, v: true });
```

---

## 🖼️ 2. Image Management (`manager.images`)

### Pull Image (`pull`)
Downloads a new image from Docker Hub.
```typescript
await manager.images.pull('redis:alpine');
```

### Search (`search`)
Searches for images on Docker Hub.
```typescript
const results = await manager.images.search('node', 5); // term and limit
```

### Management
```typescript
const images = await manager.images.list();
const imageDetails = await manager.images.inspect('redis:alpine');
await manager.images.remove('redis:alpine', true); // true = force
```

---

## 🌐 3. Network Management (`manager.networks`)

### Creation and Listing
```typescript
// Simple bridge network
await manager.networks.create('app-network', { driver: 'bridge' });

// Network with custom IP range (Subnet/Gateway)
await manager.networks.create('secure-net', {
  driver: 'bridge',
  subnet: '172.20.0.0/16',
  gateway: '172.20.0.1'
});

const networks = await manager.networks.list();
```

### Container Connections
```typescript
await manager.networks.connect('app-network', 'container-id');
await manager.networks.disconnect('app-network', 'container-id');
```

---

## 💾 4. Volume Management (`manager.volumes`)

### Advanced Creation (`create`)
Allows you to create size-limited, RAM-backed, or standard unlimited volumes.
```typescript
// 1. Standard/Unlimited Volume (Default)
await manager.volumes.create('unlimited-data');

// 2. RAM-backed 256MB volume (tmpfs)
await manager.volumes.create('cache-vol', { type: 'tmpfs', size: '256m' });

// 3. Sized local volume (Requires Linux Quota support)
await manager.volumes.create('data-vol', { size: '1gb' });
```

### Management
```typescript
const { Volumes } = await manager.volumes.list();
await manager.volumes.remove('data-vol');
const result = await manager.volumes.prune(); // Clean up ALL unused volumes
```

---

## 🛠️ 5. Automated Deployment (`deploy`)

Enables single-command deployment (Infrastructure as Code) using YAML or JSON files.

```typescript
// Automatically detects extension, parses, creates, and starts.
await manager.deploy('./deploy.yaml', 'production-service');
```

---

## 🛡️ Error Management
The system is protected with internal error handling. Detailed messages from the Docker API are emitted through the error event.

```typescript
try {
  // Methods return null on error, details are sent to manager.on('error')
  const res = await manager.containers.start('invalid-id');
} catch (error) {
  // For critical failures not handled by events
  console.error("Critical Failure:", error.message);
}
```

---
## 📋 Changelog

### v1.0.1
- **Full Docker API Container Config Support** — The `create` method now supports **all** fields from the Docker Engine API v1.43 `/containers/create` endpoint. Previously limited to `image`, `ports`, `env`, `volumes`, and `restart`. New supported fields include:
  - `cmd`, `entrypoint`, `workingDir`, `user`, `hostname`, `tty`, `labels`
  - Resource limits: `memory`, `nanoCpus`, `cpuShares`, `ulimits`, `shmSize`
  - Security: `privileged`, `capAdd`, `capDrop`, `readonlyRootfs`
  - Networking: `networkMode`, `dns`, `extraHosts`, `networks` (with IPAM config)
  - Healthcheck, LogConfig, AutoRemove, and many more
- **TypeScript Interfaces** — Added full type definitions: `ContainerConfig`, `MountConfig`, `NetworkEndpointConfig`, `DeviceRequestConfig`
- **Auto Config Transformation** — Smart conversion for `cmd` (string → array), `entrypoint` (string → array), `env` (object → array), duration strings (e.g. `"30s"` → nanoseconds), and automatic removal of undefined values from the API payload

---

*This SDK is optimized for Docker Engine API v1.43 standards.*

*@asymmetricstar
