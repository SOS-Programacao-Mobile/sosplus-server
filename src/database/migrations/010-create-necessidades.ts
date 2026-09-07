import type { Migration } from './types.js';

export const createNecessidades: Migration = {
  id: '010-create-necessidades',
  description: 'Cria a tabela de necessidades',
  async up(connection) {
    await connection.query(`
      CREATE TABLE necessidades (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        ong_id BIGINT UNSIGNED NOT NULL,
        categoria_id BIGINT UNSIGNED NOT NULL,
        titulo VARCHAR(200) NOT NULL,
        descricao TEXT NOT NULL,
        tipo VARCHAR(100) NOT NULL,
        quantidade DECIMAL(10, 2) NOT NULL,
        unidade VARCHAR(50) NOT NULL,
        imagem VARCHAR(500) NULL,
        status ENUM('ATIVA', 'ATENDIDA', 'CANCELADA') NOT NULL DEFAULT 'ATIVA',
        criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
          ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY ix_necessidades_ong (ong_id),
        KEY ix_necessidades_categoria (categoria_id),
        KEY ix_necessidades_status (status),
        CONSTRAINT fk_necessidades_ong
          FOREIGN KEY (ong_id) REFERENCES perfis_ong (id) ON DELETE CASCADE,
        CONSTRAINT fk_necessidades_categoria
          FOREIGN KEY (categoria_id) REFERENCES categorias (id) ON DELETE RESTRICT,
        CONSTRAINT ck_necessidades_quantidade CHECK (quantidade > 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};
