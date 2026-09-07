import type { Migration } from './types.js';

export const createSessoes: Migration = {
  id: '015-create-sessoes',
  description: 'Armazena sessões com token protegido por hash e expiração',
  async up(connection) {
    await connection.query(`CREATE TABLE sessoes (
      token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      usuario_id BIGINT UNSIGNED NOT NULL,
      criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      expira_em DATETIME(3) NOT NULL,
      PRIMARY KEY (token_hash),
      KEY ix_sessoes_expira_em (expira_em),
      CONSTRAINT fk_sessoes_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
};
