import type { RowDataPacket } from 'mysql2';
import type { Migration } from './types.js';

export const simulatedWalletIdempotency: Migration = {
  id: '023-simulated-wallet-idempotency',
  description: 'Cria carteira fictícia e idempotência de doações',
  async up(connection) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS carteiras_simuladas (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        doador_id BIGINT UNSIGNED NOT NULL,
        saldo_centavos BIGINT UNSIGNED NOT NULL DEFAULT 0,
        atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id), UNIQUE KEY uk_carteiras_simuladas_doador (doador_id),
        CONSTRAINT fk_carteiras_simuladas_doador FOREIGN KEY (doador_id) REFERENCES perfis_doador(id) ON DELETE CASCADE,
        CONSTRAINT ck_carteiras_simuladas_limite CHECK (saldo_centavos <= 99999999999)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    const [columns] = await connection.query<(RowDataPacket & { COLUMN_NAME: string })[]>(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'doacoes' AND COLUMN_NAME = 'chave_operacao'`);
    if (!columns.length) await connection.query('ALTER TABLE doacoes ADD COLUMN chave_operacao VARCHAR(80) NULL');
    const [indexes] = await connection.query<(RowDataPacket & { INDEX_NAME: string })[]>(`
      SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'doacoes' AND INDEX_NAME = 'uk_doacoes_doador_chave'`);
    if (!indexes.length) await connection.query('ALTER TABLE doacoes ADD UNIQUE KEY uk_doacoes_doador_chave (doador_id, chave_operacao)');
  }
};
