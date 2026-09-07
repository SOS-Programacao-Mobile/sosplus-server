import type { PoolConnection } from 'mysql2/promise';

export type Migration = {
  id: string;
  description: string;
  up: (connection: PoolConnection) => Promise<void>;
};
