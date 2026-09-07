import type { Migration } from './types.js';

export const createCampanhas: Migration = {
  id: '009-create-campanhas',
  description: 'Cria a tabela de campanhas',
  async up(connection) {
    await connection.query(`
      CREATE TABLE campanhas (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        ong_id BIGINT UNSIGNED NOT NULL,
        categoria_id BIGINT UNSIGNED NOT NULL,
        titulo VARCHAR(200) NOT NULL,
        descricao TEXT NOT NULL,
        imagem VARCHAR(500) NULL,
        meta_valor DECIMAL(12, 2) NOT NULL,
        data_inicio DATE NOT NULL,
        data_fim DATE NOT NULL,
        status ENUM('RASCUNHO', 'ATIVA', 'ENCERRADA', 'CANCELADA') NOT NULL DEFAULT 'RASCUNHO',
        criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
          ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY ix_campanhas_ong (ong_id),
        KEY ix_campanhas_categoria (categoria_id),
        KEY ix_campanhas_status (status),
        CONSTRAINT fk_campanhas_ong
          FOREIGN KEY (ong_id) REFERENCES perfis_ong (id) ON DELETE CASCADE,
        CONSTRAINT fk_campanhas_categoria
          FOREIGN KEY (categoria_id) REFERENCES categorias (id) ON DELETE RESTRICT,
        CONSTRAINT ck_campanhas_datas CHECK (data_fim >= data_inicio),
        CONSTRAINT ck_campanhas_meta_valor CHECK (meta_valor >= 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};
