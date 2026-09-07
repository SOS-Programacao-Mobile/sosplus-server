import type { Migration } from './types.js';

export const alignUsuariosComMer: Migration = {
  id: '002-align-usuarios-com-mer',
  description: 'Alinha usuários ao MER',
  async up(connection) {
    await connection.query(`
      ALTER TABLE usuarios
        DROP COLUMN nome,
        CHANGE COLUMN created_at criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CHANGE COLUMN updated_at atualizado_em DATETIME(3) NOT NULL
          DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        ADD COLUMN tipo ENUM('DOADOR', 'ONG') NOT NULL AFTER senha_hash
    `);
  }
};
