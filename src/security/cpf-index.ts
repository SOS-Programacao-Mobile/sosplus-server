import type { RowDataPacket } from 'mysql2';
import { database } from '../database/mysql.js';

export async function assertCpfIndexReady(): Promise<void> {
  let rows: (RowDataPacket & { pendentes: number })[];
  try {
    [rows] = await database.execute<(RowDataPacket & { pendentes: number })[]>(`
      SELECT COUNT(*) pendentes FROM perfis_doador p
      LEFT JOIN dados_pessoais_usuario d ON d.usuario_id = p.usuario_id
      WHERE p.cpf IS NOT NULL OR (d.cpf_cifrado IS NOT NULL AND p.cpf_hash IS NULL)
    `);
  } catch (error) {
    if ((error as { code?: string }).code === 'ER_BAD_FIELD_ERROR') {
      throw new Error('Aplique as migrações pendentes antes de iniciar a API.');
    }
    throw error;
  }
  if (Number(rows[0]?.pendentes) > 0) {
    throw new Error('Conclua a pré-verificação e execute npm run migration:cpf-backfill antes de iniciar a API.');
  }
}
