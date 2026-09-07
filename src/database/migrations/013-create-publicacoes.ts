import type { Migration } from './types.js';

export const createPublicacoes: Migration = {
  id: '013-create-publicacoes',
  description: 'Cria a tabela de publicações',
  async up(connection) {
    await connection.query(`
      CREATE TABLE publicacoes (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        ong_id BIGINT UNSIGNED NOT NULL,
        campanha_id BIGINT UNSIGNED NULL,
        texto TEXT NOT NULL,
        imagem VARCHAR(500) NULL,
        criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
          ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY ix_publicacoes_ong (ong_id),
        KEY ix_publicacoes_campanha (campanha_id),
        CONSTRAINT fk_publicacoes_ong
          FOREIGN KEY (ong_id) REFERENCES perfis_ong (id) ON DELETE CASCADE,
        CONSTRAINT fk_publicacoes_campanha
          FOREIGN KEY (campanha_id) REFERENCES campanhas (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};
