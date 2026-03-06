export interface Sample {
  id: string;
  label: string;
  note: string;
  text: string;
}

export const samples: Sample[] = [
  {
    id: 'json-users',
    label: 'JSON users',
    note: 'Uniform objects show the L1 tabular gains clearly.',
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
