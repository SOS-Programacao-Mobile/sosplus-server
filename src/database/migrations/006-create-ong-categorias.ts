import type { Migration } from './types.js';

export const createOngCategorias: Migration = {
  id: '006-create-ong-categorias',
  description: 'Cria a relação entre ONGs e categorias',
  async up(connection) {
    await connection.query(`
      CREATE TABLE ong_categorias (
        ong_id BIGINT UNSIGNED NOT NULL,
        categoria_id BIGINT UNSIGNED NOT NULL,
        PRIMARY KEY (ong_id, categoria_id),
        CONSTRAINT fk_ong_categorias_ong
          FOREIGN KEY (ong_id) REFERENCES perfis_ong (id) ON DELETE CASCADE,
        CONSTRAINT fk_ong_categorias_categoria
          FOREIGN KEY (categoria_id) REFERENCES categorias (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};
