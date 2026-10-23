import type { Migration } from './types.js';

export const createFotosPerfil: Migration = {
  id: '017-create-fotos-perfil',
  description: 'Guarda a foto de perfil de cada usuário',
  async up(connection) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS fotos_perfil (
        usuario_id BIGINT UNSIGNED NOT NULL,
        mime_type VARCHAR(32) NOT NULL,
        conteudo MEDIUMBLOB NOT NULL,
        atualizada_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
          ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (usuario_id),
        CONSTRAINT fk_fotos_perfil_usuario
          FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};
