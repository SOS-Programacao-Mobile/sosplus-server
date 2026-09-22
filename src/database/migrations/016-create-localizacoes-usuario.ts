import type { Migration } from './types.js';

export const createLocalizacoesUsuario: Migration = {
  id: '016-create-localizacoes-usuario',
  description: 'Guarda a última localização aproximada de cada usuário',
  async up(connection) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS localizacoes_usuario (
        usuario_id BIGINT UNSIGNED NOT NULL,
        cidade VARCHAR(100) NOT NULL,
        estado VARCHAR(100) NOT NULL,
        latitude DOUBLE NOT NULL,
        longitude DOUBLE NOT NULL,
        atualizada_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
          ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (usuario_id),
        CONSTRAINT fk_localizacoes_usuario_usuario
          FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};
