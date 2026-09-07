import type { Migration } from './types.js';

export const optionalCpfDoador: Migration = {
  id: '014-optional-cpf-doador',
  description: 'Permite cadastro de doador sem CPF; mantém CPF único quando informado',
  async up(connection) {
    await connection.query('ALTER TABLE perfis_doador MODIFY COLUMN cpf VARCHAR(14) NULL');
  }
};
