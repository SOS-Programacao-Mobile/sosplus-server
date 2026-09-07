import type { Migration } from './types.js';

export const createUsuarios: Migration = {
  id: '001-create-usuarios',
  description: 'Cria a tabela de usuários',
  async up(connection) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        nome VARCHAR(120) NOT NULL,
        email VARCHAR(255) NOT NULL,
        senha_hash VARCHAR(255) NOT NULL,
        ativo TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
          ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uk_usuarios_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};
