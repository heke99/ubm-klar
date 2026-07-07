export type ApiHealth = {
  service: 'api';
  status: 'ok' | 'degraded' | 'down';
  piiSafe: boolean;
};

export function getHealth(): ApiHealth {
  return {
    service: 'api',
    status: 'ok',
    piiSafe: true,
  };
}
