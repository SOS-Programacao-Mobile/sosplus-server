import type { Migration } from './types.js';

export const createDoacoesItens: Migration = {
  id: '012-create-doacoes-itens',
  description: 'Cria a tabela de doações de itens',
  async up(connection) {
    await connection.query(`
      CREATE TABLE doacoes_itens (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        doador_id BIGINT UNSIGNED NOT NULL,
        necessidade_id BIGINT UNSIGNED NOT NULL,
        quantidade DECIMAL(10, 2) NOT NULL,
        observacao TEXT NULL,
        foto VARCHAR(500) NULL,
        forma_entrega ENUM('ENTREGA_NA_ONG', 'RETIRADA') NOT NULL,
        data_entrega DATETIME(3) NULL,
        status ENUM('PENDENTE', 'ACEITA', 'ENTREGUE', 'CANCELADA') NOT NULL DEFAULT 'PENDENTE',
        criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY ix_doacoes_itens_doador (doador_id),
        KEY ix_doacoes_itens_necessidade (necessidade_id),
        KEY ix_doacoes_itens_status (status),
        CONSTRAINT fk_doacoes_itens_doador
          FOREIGN KEY (doador_id) REFERENCES perfis_doador (id) ON DELETE RESTRICT,
        CONSTRAINT fk_doacoes_itens_necessidade
          FOREIGN KEY (necessidade_id) REFERENCES necessidades (id) ON DELETE RESTRICT,
        CONSTRAINT ck_doacoes_itens_quantidade CHECK (quantidade > 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};
