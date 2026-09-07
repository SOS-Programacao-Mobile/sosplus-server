import type { Migration } from './types.js';

export const createPerfisDoador: Migration = {
  id: '004-create-perfis-doador',
  description: 'Cria a tabela de perfis de doador',
  async up(connection) {
    await connection.query(`
      CREATE TABLE perfis_doador (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        usuario_id BIGINT UNSIGNED NOT NULL,
        nome VARCHAR(150) NOT NULL,
        cpf VARCHAR(14) NOT NULL,
        data_nascimento DATE NULL,
        telefone VARCHAR(20) NULL,
        foto_perfil VARCHAR(500) NULL,
        criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
          ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uk_perfis_doador_usuario (usuario_id),
        UNIQUE KEY uk_perfis_doador_cpf (cpf),
        CONSTRAINT fk_perfis_doador_usuario
          FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};
