import type { Migration } from './types.js';

export const createLocalImages: Migration = {
  id: '020-create-local-images',
  description: 'Armazena imagens locais com propriedade e vínculo controlados',
  async up(connection) {
    await connection.query(`
      CREATE TABLE imagens (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        proprietario_usuario_id BIGINT UNSIGNED NOT NULL,
        finalidade ENUM('PERFIL_ONG', 'CAPA_ONG', 'CAMPANHA', 'NECESSIDADE', 'PUBLICACAO', 'DOACAO_ITEM') NOT NULL,
        mime_type ENUM('image/jpeg', 'image/png', 'image/webp') NOT NULL,
        conteudo MEDIUMBLOB NOT NULL,
        vinculo_tipo ENUM('PERFIL_ONG', 'CAPA_ONG', 'CAMPANHA', 'NECESSIDADE', 'PUBLICACAO', 'DOACAO_ITEM') NULL,
        vinculo_id BIGINT UNSIGNED NULL,
        criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY ix_imagens_vinculo (vinculo_tipo, vinculo_id),
        KEY ix_imagens_proprietario (proprietario_usuario_id),
        CONSTRAINT fk_imagens_proprietario FOREIGN KEY (proprietario_usuario_id)
          REFERENCES usuarios (id) ON DELETE CASCADE,
        CONSTRAINT ck_imagens_tamanho CHECK (OCTET_LENGTH(conteudo) BETWEEN 1 AND 1048576),
        CONSTRAINT ck_imagens_vinculo CHECK ((vinculo_tipo IS NULL) = (vinculo_id IS NULL))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};
