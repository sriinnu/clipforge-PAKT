import type { PaktFormat } from '@sriinnu/pakt';

export interface Sample {
  id: string;
  label: string;
  note: string;
  format: PaktFormat;
  text: string;
}

export const samples: Sample[] = [
  {
    id: 'json-orders-table',
    label: 'JSON array table',
    note: 'Top-level arrays unlock auto-pack benchmarking across JSON, CSV, and YAML layouts.',
    format: 'json',
    text: JSON.stringify(
      [
        {
          orderId: 'A-1001',
          region: 'EMEA',
          rep: 'Alice',
          product: 'platform',
          quarter: 'Q1',
          amount: 1299.5,
          status: 'won',
        },
        {
          orderId: 'A-1002',
          region: 'EMEA',
          rep: 'Alice',
          product: 'support',
          quarter: 'Q1',
          amount: 899,
          status: 'won',
        },
        {
          orderId: 'A-1003',
          region: 'NA',
          rep: 'Bob',
          product: 'platform',
          quarter: 'Q2',
          amount: 650,
          status: 'pending',
        },
        {
          orderId: 'A-1004',
          region: 'NA',
          rep: 'Bob',
          product: 'analytics',
          quarter: 'Q2',
          amount: 1850,
          status: 'won',
        },
      ],
      null,
      2,
    ),
  },
  {
    id: 'json-users',
    label: 'JSON users',
    note: 'Uniform objects show the L1 tabular gains clearly.',
    format: 'json',
    text: JSON.stringify(
      {
        users: [
          { name: 'Alice', role: 'platform', region: 'eu-central-1', active: true },
          { name: 'Bob', role: 'platform', region: 'us-east-1', active: true },
          { name: 'Carol', role: 'product', region: 'eu-central-1', active: false },
          { name: 'Dinesh', role: 'platform', region: 'us-east-1', active: true },
        ],
      },
      null,
      2,
    ),
  },
  {
    id: 'mixed-markdown',
    label: 'Mixed markdown',
    note: 'The prose stays readable while embedded structured blocks are compressed in place.',
    format: 'markdown',
    text: [
      '# Incident summary',
      '',
      'The app stayed up, but one region degraded for 14 minutes.',
      '',
      '```json',
      '{',
      '  "alerts": [',
      '    { "service": "api", "region": "us-east-1", "severity": "high" },',
      '    { "service": "worker", "region": "us-east-1", "severity": "high" },',
      '    { "service": "api", "region": "eu-central-1", "severity": "low" }',
      '  ]',
      '}',
      '```',
      '',
      'Follow-up: reduce alert fan-out on duplicate incidents.',
    ].join('\n'),
  },
  {
    id: 'yaml-services',
    label: 'YAML services',
    note: 'Small YAML configs can be near break-even. Try JSON users or Mixed markdown first for a stronger demo.',
    format: 'yaml',
    text: [
      'services:',
      '  api:',
      '    image: ghcr.io/acme/api:1.4.2',
      '    replicas: 3',
      '    env:',
      '      REGION: eu-central-1',
      '      LOG_LEVEL: info',
      '  worker:',
      '    image: ghcr.io/acme/worker:1.4.2',
      '    replicas: 2',
      '    env:',
      '      REGION: eu-central-1',
      '      LOG_LEVEL: info',
    ].join('\n'),
  },
  {
    id: 'csv-sales',
    label: 'CSV edge case',
    note: 'Honesty check: flat CSV is already compact, so PAKT can be neutral or worse here.',
    format: 'csv',
    text: [
      'order_id,region,rep,amount,status',
      'A-1001,EMEA,Alice,1299.50,won',
      'A-1002,EMEA,Alice,899.00,won',
      'A-1003,NA,Bob,650.00,pending',
      'A-1004,NA,Bob,1850.00,won',
      'A-1005,APAC,Carol,410.00,lost',
    ].join('\n'),
  },
];
