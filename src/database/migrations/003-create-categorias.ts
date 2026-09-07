import type { Migration } from './types.js';

export const createCategorias: Migration = {
  id: '003-create-categorias',
  description: 'Cria a tabela de categorias',
  async up(connection) {
    await connection.query(`
      CREATE TABLE categorias (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        nome VARCHAR(100) NOT NULL,
        descricao VARCHAR(255) NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_categorias_nome (nome)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};
