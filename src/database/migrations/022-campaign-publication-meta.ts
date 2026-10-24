import type { RowDataPacket } from 'mysql2';
import type { Migration } from './types.js';

export const campaignPublicationMeta: Migration = {
  id: '022-campaign-publication-meta',
  description: 'Exige meta positiva para campanhas fora de rascunho',
  async up(connection) {
    const [invalid] = await connection.query<(RowDataPacket & { id: string })[]>(`
      SELECT CAST(id AS CHAR) id FROM campanhas WHERE meta_valor <= 0 AND status <> 'RASCUNHO' LIMIT 20
    `);
    if (invalid.length) throw new Error(`Migração bloqueada: campanhas publicadas com meta não positiva: ${invalid.map((row) => row.id).join(', ')}.`);
    await connection.query(`ALTER TABLE campanhas ADD CONSTRAINT ck_campanhas_meta_publicada CHECK (meta_valor > 0 OR status = 'RASCUNHO')`);
  }
};
