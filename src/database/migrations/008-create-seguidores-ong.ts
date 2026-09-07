import type { Migration } from './types.js';

export const createSeguidoresOng: Migration = {
  id: '008-create-seguidores-ong',
  description: 'Cria a relação de seguidores de ONG',
  async up(connection) {
    await connection.query(`
      CREATE TABLE seguidores_ong (
        doador_id BIGINT UNSIGNED NOT NULL,
        ong_id BIGINT UNSIGNED NOT NULL,
        criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (doador_id, ong_id),
        KEY ix_seguidores_ong_ong (ong_id),
        CONSTRAINT fk_seguidores_ong_doador
          FOREIGN KEY (doador_id) REFERENCES perfis_doador (id) ON DELETE CASCADE,
        CONSTRAINT fk_seguidores_ong_ong
          FOREIGN KEY (ong_id) REFERENCES perfis_ong (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};
