import type { Migration } from './types.js';

export const createEnderecosOng: Migration = {
  id: '007-create-enderecos-ong',
  description: 'Cria a tabela de endereços de ONG',
  async up(connection) {
    await connection.query(`
      CREATE TABLE enderecos_ong (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        ong_id BIGINT UNSIGNED NOT NULL,
        cep VARCHAR(9) NOT NULL,
        logradouro VARCHAR(255) NOT NULL,
        numero VARCHAR(20) NOT NULL,
        complemento VARCHAR(100) NULL,
        bairro VARCHAR(100) NOT NULL,
        cidade VARCHAR(100) NOT NULL,
        estado VARCHAR(2) NOT NULL,
        latitude DECIMAL(10, 8) NULL,
        longitude DECIMAL(11, 8) NULL,
        PRIMARY KEY (id),
        KEY ix_enderecos_ong_ong (ong_id),
        CONSTRAINT fk_enderecos_ong_ong
          FOREIGN KEY (ong_id) REFERENCES perfis_ong (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};
