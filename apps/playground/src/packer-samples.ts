import type { PackerRunItem } from './pakt-runtime';

export interface PackerSample {
  id: string;
  label: string;
  priority: number;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export const DEFAULT_PACKER_ITEMS: readonly PackerSample[] = [
  {
    id: 'db-result',
    label: 'DB query — user orders',
    role: 'tool',
    priority: 10,
    content: `{"orders":[{"id":"ORD-001","customer":"Alice Johnson","email":"alice@example.com","items":[{"sku":"WIDGET-A","qty":3,"price":9.99},{"sku":"GADGET-B","qty":1,"price":49.00}],"total":78.97,"status":"shipped","created":"2024-01-15T09:21:00Z"},{"id":"ORD-002","customer":"Bob Smith","email":"bob@example.com","items":[{"sku":"WIDGET-A","qty":1,"price":9.99},{"sku":"TOOL-C","qty":2,"price":24.50}],"total":58.99,"status":"processing","created":"2024-01-15T11:45:00Z"},{"id":"ORD-003","customer":"Carol White","email":"carol@example.com","items":[{"sku":"GADGET-B","qty":2,"price":49.00}],"total":98.00,"status":"pending","created":"2024-01-15T14:02:00Z"}]}`,
  },
  {
    id: 'rag-docs',
    label: 'RAG chunk — API docs',
    role: 'tool',
    priority: 8,
    content: `# Authentication\n\nAll API requests require a Bearer token in the Authorization header.\n\n## Token format\n\`\`\`\nAuthorization: Bearer <token>\n\`\`\`\n\n## Obtaining tokens\nPOST /auth/token with your API key:\n\`\`\`json\n{"apiKey":"your-api-key","expiresIn":3600}\n\`\`\`\n\n## Token refresh\nTokens expire after the requested period. Refresh before expiry using POST /auth/refresh:\n\`\`\`json\n{"refreshToken":"your-refresh-token"}\n\`\`\`\n\n## Rate limits\n- Free tier: 100 requests/minute\n- Pro tier: 1000 requests/minute\n- Enterprise: custom limits`,
  },
  {
    id: 'yaml-config',
    label: 'System config — YAML',
    role: 'tool',
    priority: 6,
    content: `version: "3.9"\nservices:\n  api:\n    image: myapp/api:latest\n    environment:\n      - NODE_ENV=production\n      - DATABASE_URL=postgres://db:5432/myapp\n      - REDIS_URL=redis://cache:6379\n      - LOG_LEVEL=info\n      - MAX_WORKERS=4\n      - TIMEOUT_MS=30000\n    ports:\n      - "3000:3000"\n    healthcheck:\n      test: ["CMD","curl","-f","http://localhost:3000/health"]\n      interval: 30s\n      timeout: 10s\n      retries: 3\n  db:\n    image: postgres:15\n    environment:\n      - POSTGRES_DB=myapp\n      - POSTGRES_USER=admin\n      - POSTGRES_PASSWORD=secret\n    volumes:\n      - postgres_data:/var/lib/postgresql/data\n  cache:\n    image: redis:7-alpine\n    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru`,
  },
  {
    id: 'event-log',
    label: 'Audit log — CSV',
    role: 'tool',
    priority: 4,
    content: `timestamp,event,user_id,resource,status,duration_ms\n2024-01-15T08:00:01Z,login,user_1042,/auth,success,45\n2024-01-15T08:00:03Z,fetch,user_1042,/api/orders,success,123\n2024-01-15T08:00:05Z,fetch,user_1042,/api/orders/ORD-001,success,89\n2024-01-15T08:01:12Z,login,user_2091,/auth,success,52\n2024-01-15T08:01:14Z,fetch,user_2091,/api/products,success,201\n2024-01-15T08:01:16Z,fetch,user_2091,/api/products/WIDGET-A,success,67\n2024-01-15T08:02:30Z,login,user_3178,/auth,failed,38\n2024-01-15T08:02:31Z,login,user_3178,/auth,failed,35\n2024-01-15T08:02:32Z,login,user_3178,/auth,failed,36\n2024-01-15T08:03:00Z,login,user_1042,/auth,success,49\n2024-01-15T08:03:02Z,update,user_1042,/api/orders/ORD-001,success,445\n2024-01-15T08:04:15Z,fetch,user_2091,/api/orders,success,156\n2024-01-15T08:05:00Z,delete,user_1042,/api/orders/ORD-002,forbidden,12`,
  },
];

export function toPackerRunItems(items: readonly PackerSample[]): PackerRunItem[] {
  return items.map(({ id, content, priority, role }) => ({ id, content, priority, role }));
}
