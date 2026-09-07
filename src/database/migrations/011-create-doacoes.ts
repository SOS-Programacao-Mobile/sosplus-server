import type { Migration } from './types.js';

export const createDoacoes: Migration = {
  id: '011-create-doacoes',
  description: 'Cria a tabela de doações financeiras',
  async up(connection) {
    await connection.query(`
      CREATE TABLE doacoes (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        doador_id BIGINT UNSIGNED NOT NULL,
        campanha_id BIGINT UNSIGNED NOT NULL,
        valor DECIMAL(12, 2) NOT NULL,
        anonima TINYINT(1) NOT NULL DEFAULT 0,
        status ENUM('PENDENTE', 'CONFIRMADA', 'CANCELADA') NOT NULL DEFAULT 'PENDENTE',
        data_doacao DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY ix_doacoes_doador (doador_id),
        KEY ix_doacoes_campanha (campanha_id),
        KEY ix_doacoes_status (status),
        CONSTRAINT fk_doacoes_doador
          FOREIGN KEY (doador_id) REFERENCES perfis_doador (id) ON DELETE RESTRICT,
        CONSTRAINT fk_doacoes_campanha
          FOREIGN KEY (campanha_id) REFERENCES campanhas (id) ON DELETE RESTRICT,
        CONSTRAINT ck_doacoes_valor CHECK (valor > 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};
