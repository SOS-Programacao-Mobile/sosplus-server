import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { database } from '../database/mysql.js';
import { AuthError, validateProfilePhoto } from '../auth/validation.js';
import { currentUser, type PublicUser } from '../auth/service.js';

const purposes = new Set(['PERFIL_ONG', 'CAPA_ONG', 'CAMPANHA', 'NECESSIDADE', 'PUBLICACAO', 'DOACAO_ITEM']);

export async function saveImage(token: string, content: unknown, mimeType: unknown, purpose: unknown): Promise<{ id: string; mimeType: string }> {
  const user = await currentUser(token);
  if (typeof purpose !== 'string' || !purposes.has(purpose)) throw new AuthError(400, 'Finalidade de imagem inválida.');
  if ((user.tipo === 'DOADOR' && purpose !== 'DOACAO_ITEM') || (user.tipo === 'ONG' && purpose === 'DOACAO_ITEM')) {
    throw new AuthError(403, 'Esta finalidade não está disponível para o perfil selecionado.');
  }
  const image = validateProfilePhoto(content, mimeType);
  const [result] = await database.execute<ResultSetHeader>(
    'INSERT INTO imagens (proprietario_usuario_id, finalidade, mime_type, conteudo) VALUES (?, ?, ?, ?)',
    [user.id, purpose, image.mimeType, image.conteudo]
  );
  return { id: String(result.insertId), mimeType: image.mimeType };
}

export async function linkImage(user: PublicUser, imageId: string, purpose: string, entityId: string): Promise<void> {
  if (!/^\d+$/.test(imageId) || !/^\d+$/.test(entityId) || !purposes.has(purpose)) throw new AuthError(400, 'Vínculo de imagem inválido.');
  const ownerSql = purpose === 'PERFIL_ONG' || purpose === 'CAPA_ONG'
    ? 'SELECT 1 FROM perfis_ong WHERE id = ? AND usuario_id = ?'
    : purpose === 'CAMPANHA'
      ? 'SELECT 1 FROM campanhas c JOIN perfis_ong p ON p.id = c.ong_id WHERE c.id = ? AND p.usuario_id = ?'
      : purpose === 'NECESSIDADE'
        ? 'SELECT 1 FROM necessidades n JOIN perfis_ong p ON p.id = n.ong_id WHERE n.id = ? AND p.usuario_id = ?'
        : purpose === 'PUBLICACAO'
          ? 'SELECT 1 FROM publicacoes b JOIN perfis_ong p ON p.id = b.ong_id WHERE b.id = ? AND p.usuario_id = ?'
          : 'SELECT 1 FROM doacoes_itens d JOIN perfis_doador p ON p.id = d.doador_id WHERE d.id = ? AND p.usuario_id = ?';
  const [entities] = await database.execute<RowDataPacket[]>(ownerSql, [entityId, user.id]);
  if (!entities.length) throw new AuthError(404, 'Conteúdo não encontrado.');
  const [result] = await database.execute<ResultSetHeader>(`
    UPDATE imagens SET vinculo_tipo = ?, vinculo_id = ?
    WHERE id = ? AND proprietario_usuario_id = ? AND finalidade = ?
      AND (vinculo_id IS NULL OR (vinculo_tipo = ? AND vinculo_id = ?))`,
  [purpose, entityId, imageId, user.id, purpose, purpose, entityId]);
  if (!result.affectedRows) {
    const [existing] = await database.execute<RowDataPacket[]>(
      `SELECT 1 FROM imagens WHERE id = ? AND proprietario_usuario_id = ? AND finalidade = ? AND vinculo_tipo = ? AND vinculo_id = ? LIMIT 1`,
      [imageId, user.id, purpose, purpose, entityId]
    );
    if (!existing.length) throw new AuthError(404, 'Imagem própria e disponível não encontrada.');
  }
}

export async function loadImage(id: string, user: PublicUser | null): Promise<{ mimeType: string; content: Buffer }> {
  if (!/^\d+$/.test(id)) throw new AuthError(404, 'Imagem não encontrada.');
  const [rows] = await database.execute<(RowDataPacket & {
    mime_type: string; conteudo: Buffer; proprietario_usuario_id: string; vinculo_tipo: string | null; vinculo_id: string | null;
  })[]>(`SELECT mime_type, conteudo, CAST(proprietario_usuario_id AS CHAR) proprietario_usuario_id,
      vinculo_tipo, CAST(vinculo_id AS CHAR) vinculo_id FROM imagens WHERE id = ? LIMIT 1`, [id]);
  const image = rows[0];
  if (!image) throw new AuthError(404, 'Imagem não encontrada.');
  if (user?.id === image.proprietario_usuario_id) return { mimeType: image.mime_type, content: image.conteudo };
  if (await isPublic(id)) return { mimeType: image.mime_type, content: image.conteudo };
  if (user && image.vinculo_tipo === 'DOACAO_ITEM' && await isDonationParty(image.vinculo_id!, user.id)) {
    return { mimeType: image.mime_type, content: image.conteudo };
  }
  throw new AuthError(404, 'Imagem não encontrada.');
}

async function isPublic(id: string): Promise<boolean> {
  const [rows] = await database.execute<(RowDataPacket & { public: number })[]>(`
    SELECT EXISTS (
      SELECT 1 FROM imagens i
      JOIN perfis_ong p ON p.id = i.vinculo_id
      JOIN usuarios u ON u.id = p.usuario_id AND u.ativo = 1
      WHERE i.id = ? AND i.vinculo_tipo IN ('PERFIL_ONG', 'CAPA_ONG')
      UNION ALL
      SELECT 1 FROM imagens i
      JOIN campanhas c ON c.id = i.vinculo_id AND c.status IN ('ATIVA', 'ENCERRADA')
      JOIN perfis_ong p ON p.id = c.ong_id
      JOIN usuarios u ON u.id = p.usuario_id AND u.ativo = 1
      WHERE i.id = ? AND i.vinculo_tipo = 'CAMPANHA'
      UNION ALL
      SELECT 1 FROM imagens i
      JOIN necessidades n ON n.id = i.vinculo_id AND n.status IN ('ATIVA', 'ATENDIDA')
      JOIN perfis_ong p ON p.id = n.ong_id
      JOIN usuarios u ON u.id = p.usuario_id AND u.ativo = 1
      WHERE i.id = ? AND i.vinculo_tipo = 'NECESSIDADE'
      UNION ALL
      SELECT 1 FROM imagens i
      JOIN publicacoes b ON b.id = i.vinculo_id
      JOIN perfis_ong p ON p.id = b.ong_id
      JOIN usuarios u ON u.id = p.usuario_id AND u.ativo = 1
      WHERE i.id = ? AND i.vinculo_tipo = 'PUBLICACAO'
      ) is_public`, [id, id, id, id]);
  return Number(rows[0]?.is_public) === 1;
}

async function isDonationParty(donationId: string, userId: string): Promise<boolean> {
  const [rows] = await database.execute<(RowDataPacket & { allowed: number })[]>(`
    SELECT EXISTS (
      SELECT 1 FROM doacoes_itens d
      JOIN perfis_doador donor ON donor.id = d.doador_id
      JOIN necessidades n ON n.id = d.necessidade_id
      JOIN perfis_ong ong ON ong.id = n.ong_id
      WHERE d.id = ? AND (donor.usuario_id = ? OR ong.usuario_id = ?)
    ) allowed`, [donationId, userId, userId]);
  return Number(rows[0]?.allowed) === 1;
}
