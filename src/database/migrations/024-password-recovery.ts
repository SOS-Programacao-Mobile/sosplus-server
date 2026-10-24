import type { Migration } from './types.js';

export const passwordRecovery: Migration = {
  id: '024-password-recovery',
  description: 'Armazena códigos de recuperação de senha somente com hash e prazo',
  async up(connection) {
    await connection.query(`CREATE TABLE recuperacoes_senha (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      usuario_id BIGINT UNSIGNED NOT NULL,
      codigo_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      expira_em DATETIME(3) NOT NULL,
      tentativas TINYINT UNSIGNED NOT NULL DEFAULT 0,
      revogado_em DATETIME(3) NULL,
      consumido_em DATETIME(3) NULL,
      PRIMARY KEY (id),
      KEY ix_recuperacoes_usuario (usuario_id, criado_em),
      CONSTRAINT fk_recuperacoes_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
};
