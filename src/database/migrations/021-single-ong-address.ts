import type { RowDataPacket } from 'mysql2';
import type { Migration } from './types.js';

export const singleOngAddress: Migration = {
  id: '021-single-ong-address',
  description: 'Restringe uma sede por ONG e exige coordenadas em par',
  async up(connection) {
    const [duplicates] = await connection.query<(RowDataPacket & { ong_id: string })[]>(`
      SELECT CAST(ong_id AS CHAR) ong_id FROM enderecos_ong GROUP BY ong_id HAVING COUNT(*) > 1 LIMIT 10
    `);
    if (duplicates.length) {
      throw new Error(`Migração bloqueada: ONGs com mais de um endereço: ${duplicates.map((row) => row.ong_id).join(', ')}.`);
    }
    const [incomplete] = await connection.query<(RowDataPacket & { id: string })[]>(`
      SELECT CAST(id AS CHAR) id FROM enderecos_ong
      WHERE (latitude IS NULL) <> (longitude IS NULL) LIMIT 10
    `);
    if (incomplete.length) {
      throw new Error(`Migração bloqueada: endereços com coordenadas incompletas: ${incomplete.map((row) => row.id).join(', ')}.`);
    }
    await connection.query(`
      ALTER TABLE enderecos_ong
        ADD UNIQUE KEY uk_enderecos_ong_sede (ong_id),
        ADD CONSTRAINT ck_enderecos_ong_coordenadas CHECK ((latitude IS NULL) = (longitude IS NULL))
    `);
  }
};
