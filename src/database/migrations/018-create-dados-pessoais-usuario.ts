import type { Migration } from './types.js';

export const createDadosPessoaisUsuario: Migration = {
  id: '018-create-dados-pessoais-usuario',
  description: 'Guarda dados pessoais cifrados do usuário',
  async up(connection) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS dados_pessoais_usuario (
        usuario_id BIGINT UNSIGNED NOT NULL,
        nome_cifrado BLOB NOT NULL,
        sobrenome_cifrado BLOB NULL,
        cpf_cifrado BLOB NULL,
        data_nascimento_cifrada BLOB NULL,
        endereco_cifrado BLOB NULL,
        tipo_sanguineo_cifrado BLOB NULL,
        genero_cifrado BLOB NULL,
        telefone_cifrado BLOB NULL,
        atualizada_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
          ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (usuario_id),
        CONSTRAINT fk_dados_pessoais_usuario
          FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};
