import type { Migration } from './types.js';

export const createPerfisOng: Migration = {
  id: '005-create-perfis-ong',
  description: 'Cria a tabela de perfis de ONG',
  async up(connection) {
    await connection.query(`
      CREATE TABLE perfis_ong (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        usuario_id BIGINT UNSIGNED NOT NULL,
        nome VARCHAR(200) NOT NULL,
        cnpj VARCHAR(18) NOT NULL,
        descricao TEXT NULL,
        ano_fundacao INT NULL,
        telefone VARCHAR(20) NULL,
        foto_perfil VARCHAR(500) NULL,
        foto_capa VARCHAR(500) NULL,
        site VARCHAR(255) NULL,
        instagram VARCHAR(255) NULL,
        chave_pix VARCHAR(255) NULL,
        criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
          ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uk_perfis_ong_usuario (usuario_id),
        UNIQUE KEY uk_perfis_ong_cnpj (cnpj),
        CONSTRAINT fk_perfis_ong_usuario
          FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};
