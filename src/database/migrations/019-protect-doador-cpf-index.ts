import type { Migration } from './types.js';

export const protectDoadorCpfIndex: Migration = {
  id: '019-protect-doador-cpf-index',
  description: 'Adiciona índice protegido para unicidade do CPF do doador',
  async up(connection) {
    await connection.query(`
      ALTER TABLE perfis_doador
        ADD COLUMN cpf_hash BINARY(32) NULL,
        ADD UNIQUE KEY uk_perfis_doador_cpf_hash (cpf_hash)
    `);
  }
};
