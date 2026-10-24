import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { database } from '../database/mysql.js';
import { currentUser } from '../auth/service.js';
import { AuthError } from '../auth/validation.js';
import { requireUserType } from '../auth/session.js';
import { validateCampaign, validateCampaignStatus } from './validation.js';

type CampaignRow = RowDataPacket & {
  id: string; ong_id: string; ong_nome: string; categoria_id: string; categoria_nome: string; titulo: string;
  descricao: string; meta_valor: string; data_inicio: string | Date; data_fim: string | Date; status: string;
  imagem: string | null; arrecadado: string; criado_em: string | Date; local_rank?: number;
};

export async function createCampaign(token: string, body: unknown) {
  const user = requireUserType(await currentUser(token), 'ONG');
  const input = validateCampaign(body);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [profiles] = await connection.execute<(RowDataPacket & { id: string })[]>(
      'SELECT CAST(id AS CHAR) id FROM perfis_ong WHERE usuario_id = ? FOR UPDATE', [user.id]);
    if (!profiles[0]) throw new AuthError(404, 'ONG não encontrada.');
    const [categories] = await connection.execute<RowDataPacket[]>('SELECT id FROM categorias WHERE id = ?', [input.categoriaId]);
    if (!categories.length) throw new AuthError(400, 'Categoria não encontrada.');
    await assertImage(connection, user.id, input.imagemId);
    const [result] = await connection.execute<ResultSetHeader>(`
      INSERT INTO campanhas (ong_id, categoria_id, titulo, descricao, meta_valor, data_inicio, data_fim, status, imagem)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'RASCUNHO', ?)` , [
      profiles[0].id, input.categoriaId, input.titulo, input.descricao, centsToDecimal(input.metaCentavos),
      input.inicioEm, input.fimEm, input.imagemId ?? null,
    ]);
    if (input.imagemId) await linkImage(connection, user.id, input.imagemId, String(result.insertId));
    await connection.commit();
    return campaignById(String(result.insertId), token);
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function updateCampaign(token: string, id: string, body: unknown) {
  const user = requireUserType(await currentUser(token), 'ONG');
  const input = validateCampaign(body);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<(RowDataPacket & { id: string; status: string; imagem: string | null })[]>(`
      SELECT CAST(c.id AS CHAR) id, c.status, c.imagem FROM campanhas c JOIN perfis_ong p ON p.id = c.ong_id
      WHERE c.id = ? AND p.usuario_id = ? FOR UPDATE`, [id, user.id]);
    if (!rows[0]) throw new AuthError(404, 'Campanha não encontrada.');
    if (rows[0].status !== 'RASCUNHO') throw new AuthError(409, 'Somente rascunhos podem ser editados.');
    const [categories] = await connection.execute<RowDataPacket[]>('SELECT id FROM categorias WHERE id = ?', [input.categoriaId]);
    if (!categories.length) throw new AuthError(400, 'Categoria não encontrada.');
    const imageId = input.imagemId ?? rows[0].imagem;
    if (input.imagemId) await assertImage(connection, user.id, input.imagemId, id);
    await connection.execute(`UPDATE campanhas SET categoria_id=?, titulo=?, descricao=?, meta_valor=?, data_inicio=?, data_fim=?, imagem=? WHERE id=?`, [
      input.categoriaId, input.titulo, input.descricao, centsToDecimal(input.metaCentavos), input.inicioEm, input.fimEm, imageId, id,
    ]);
    if (input.imagemId) await linkImage(connection, user.id, input.imagemId, id);
    await connection.commit();
    return campaignById(id, token);
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function changeCampaignStatus(token: string, id: string, body: unknown) {
  const user = requireUserType(await currentUser(token), 'ONG');
  const next = validateCampaignStatus(body);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<(RowDataPacket & { status: string; meta_valor: string; data_inicio: string | Date; data_fim: string | Date })[]>(`
      SELECT c.status, c.meta_valor, c.data_inicio, c.data_fim FROM campanhas c
      JOIN perfis_ong p ON p.id = c.ong_id WHERE c.id = ? AND p.usuario_id = ? FOR UPDATE`, [id, user.id]);
    if (!rows[0]) throw new AuthError(404, 'Campanha não encontrada.');
    const row = rows[0];
    const today = localDate();
    const allowed = (row.status === 'RASCUNHO' && ['ATIVA', 'CANCELADA'].includes(next)) ||
      (row.status === 'ATIVA' && ['ENCERRADA', 'CANCELADA'].includes(next));
    if (!allowed) throw new AuthError(409, 'Transição de campanha inválida.');
    if (next === 'ATIVA') {
      if (Number(row.meta_valor) <= 0) throw new AuthError(400, 'A meta deve ser maior que zero para publicar.');
      if (dateString(row.data_fim) < today) throw new AuthError(400, 'O período da campanha já terminou.');
    }
    await connection.execute('UPDATE campanhas SET status = ? WHERE id = ?', [next, id]);
    await connection.commit();
    return campaignById(id, token);
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function myCampaigns(token: string, status?: unknown) {
  const user = requireUserType(await currentUser(token), 'ONG');
  const filter = status === undefined ? null : String(status).toUpperCase();
  if (filter && !['RASCUNHO', 'ATIVA', 'ENCERRADA', 'CANCELADA'].includes(filter)) throw new AuthError(400, 'Filtro de status inválido.');
  await closeExpiredCampaigns(user.id);
  const conditions = ['p.usuario_id = ?'];
  const params: unknown[] = [user.id];
  if (filter) { conditions.push('c.status = ?'); params.push(filter); }
  const [rows] = await database.execute<CampaignRow[]>(`
    ${campaignSelect} WHERE ${conditions.join(' AND ')} GROUP BY c.id, p.id, cat.id ORDER BY c.criado_em DESC, c.id DESC`, params as never[]);
  return rows.map(toCampaign);
}

export async function campaigns(query: { status?: unknown; cursor?: unknown; city?: unknown; state?: unknown; limit?: unknown }) {
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AuthError(400, 'Limite de página inválido.');
  const filter = query.status === undefined ? null : String(query.status).toUpperCase();
  if (filter && !['ATIVA', 'ENCERRADA'].includes(filter)) throw new AuthError(400, 'Filtro de status inválido.');
  const city = typeof query.city === 'string' && query.city.trim() ? query.city.trim() : null;
  const state = typeof query.state === 'string' && query.state.trim() ? query.state.trim() : null;
  const today = localDate();
  await database.execute("UPDATE campanhas SET status='ENCERRADA' WHERE status='ATIVA' AND data_fim < ?", [today]);
  const localCase = city && state ? 'CASE WHEN LOWER(TRIM(e.cidade)) = LOWER(TRIM(?)) AND UPPER(TRIM(e.estado)) = UPPER(TRIM(?)) THEN 0 ELSE 1 END' : '1';
  const cursor = decodeCursor(query.cursor);
  const where = ["base.status IN ('ATIVA', 'ENCERRADA')"];
  const params: unknown[] = [];
  if (filter) { where.push('base.status = ?'); params.push(filter); }
  if (cursor) {
    where.push('(base.local_rank > ? OR (base.local_rank = ? AND (base.criado_em < ? OR (base.criado_em = ? AND base.id < ?))))');
    params.push(cursor.local, cursor.local);
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const paginationParams = city && state ? [city, state] : [];
  const [rows] = await database.execute<CampaignRow[]>(`
    SELECT base.* FROM (
      SELECT c.id, CAST(c.ong_id AS CHAR) ong_id, p.nome ong_nome, CAST(c.categoria_id AS CHAR) categoria_id,
        cat.nome categoria_nome, c.titulo, c.descricao, c.meta_valor, c.data_inicio, c.data_fim,
        c.status,
        c.imagem, c.criado_em, ${localCase} local_rank,
        COALESCE(SUM(CASE WHEN d.status = 'CONFIRMADA' THEN d.valor ELSE 0 END),0) arrecadado
      FROM campanhas c JOIN perfis_ong p ON p.id = c.ong_id JOIN usuarios u ON u.id = p.usuario_id AND u.ativo = 1
      JOIN categorias cat ON cat.id = c.categoria_id LEFT JOIN enderecos_ong e ON e.ong_id = p.id
      LEFT JOIN doacoes d ON d.campanha_id = c.id
      WHERE c.status = 'ENCERRADA' OR (c.status = 'ATIVA' AND c.data_inicio <= ? AND c.data_fim >= ?)
      GROUP BY c.id, p.id, cat.id, e.id
    ) base WHERE ${where.join(' AND ')} ORDER BY base.local_rank, base.criado_em DESC, base.id DESC LIMIT ?`,
  [...paginationParams, today, today, ...params, limit + 1] as never[]);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { resultados: page.map(toCampaign), continuacao: more && last ? encodeCursor({ local: Number(last.local_rank ?? 1), createdAt: dateTimeString(last.criado_em), id: String(last.id) }) : null };
}

export async function campaignById(id: string, token?: string) {
  if (!/^\d+$/.test(id)) throw new AuthError(404, 'Campanha não encontrada.');
  await closeExpiredCampaignsById(id);
  const [rows] = await database.execute<CampaignRow[]>(`${campaignSelect} WHERE c.id = ? GROUP BY c.id, p.id, cat.id LIMIT 1`, [id]);
  if (!rows[0]) throw new AuthError(404, 'Campanha não encontrada.');
  const campaign = rows[0];
  if (!['ATIVA', 'ENCERRADA'].includes(campaign.status)) {
    if (!token) throw new AuthError(404, 'Campanha não encontrada.');
    const user = requireUserType(await currentUser(token), 'ONG');
    const [owner] = await database.execute<RowDataPacket[]>(`SELECT 1 FROM perfis_ong WHERE id=? AND usuario_id=?`, [campaign.ong_id, user.id]);
    if (!owner.length) throw new AuthError(404, 'Campanha não encontrada.');
  }
  return toCampaign(campaign);
}

const campaignSelect = `SELECT CAST(c.id AS CHAR) id, CAST(c.ong_id AS CHAR) ong_id, p.nome ong_nome,
  CAST(c.categoria_id AS CHAR) categoria_id, cat.nome categoria_nome, c.titulo, c.descricao,
  c.meta_valor, c.data_inicio, c.data_fim,
  c.status,
  c.imagem, c.criado_em, COALESCE(SUM(CASE WHEN d.status = 'CONFIRMADA' THEN d.valor ELSE 0 END),0) arrecadado
  FROM campanhas c JOIN perfis_ong p ON p.id = c.ong_id JOIN categorias cat ON cat.id = c.categoria_id
  LEFT JOIN doacoes d ON d.campanha_id = c.id`;

function toCampaign(row: CampaignRow) {
  return {
    id: String(row.id), ongId: String(row.ong_id), ongNome: row.ong_nome,
    categoria: { id: String(row.categoria_id), nome: row.categoria_nome }, titulo: row.titulo,
    descricao: row.descricao, metaCentavos: decimalToCents(String(row.meta_valor)),
    arrecadadoCentavos: decimalToCents(String(row.arrecadado)), status: row.status,
    inicioEm: dateString(row.data_inicio), fimEm: dateString(row.data_fim), imagemId: row.imagem,
  };
}

function decimalToCents(value: string): number {
  const [units, cents = '00'] = value.split('.');
  return Number(units) * 100 + Number(cents.padEnd(2, '0').slice(0, 2));
}
function centsToDecimal(value: number): string { return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`; }
function dateString(value: string | Date): string { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10); }
function dateTimeString(value: string | Date): string { return value instanceof Date ? value.toISOString().replace('T', ' ').slice(0, 23) : String(value); }
function localDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts();
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
}
async function closeExpiredCampaigns(userId: string) {
  await database.execute(`UPDATE campanhas c JOIN perfis_ong p ON p.id = c.ong_id SET c.status = 'ENCERRADA'
    WHERE p.usuario_id = ? AND c.status = 'ATIVA' AND c.data_fim < ?`, [userId, localDate()]);
}
async function closeExpiredCampaignsById(id: string) {
  await database.execute("UPDATE campanhas SET status='ENCERRADA' WHERE id=? AND status='ATIVA' AND data_fim < ?", [id, localDate()]);
}
function decodeCursor(value: unknown): { local: number; createdAt: string; id: string } | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new AuthError(400, 'Continuação inválida.');
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if ((parsed.local !== 0 && parsed.local !== 1) || typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || !/^\d+$/.test(parsed.id)) throw new Error();
    return parsed as { local: number; createdAt: string; id: string };
  } catch { throw new AuthError(400, 'Continuação inválida.'); }
}
function encodeCursor(value: { local: number; createdAt: string; id: string }): string { return Buffer.from(JSON.stringify(value)).toString('base64url'); }

async function assertImage(connection: PoolConnection, userId: string, imageId?: string | null, campaignId: string | null = null) {
  if (!imageId) return;
  const [images] = await connection.execute<RowDataPacket[]>(`SELECT id FROM imagens WHERE id=? AND proprietario_usuario_id=? AND finalidade='CAMPANHA' AND (vinculo_id IS NULL OR (vinculo_tipo='CAMPANHA' AND vinculo_id=?)) FOR UPDATE`, [imageId, userId, campaignId]);
  if (!images.length) throw new AuthError(404, 'Imagem própria e disponível não encontrada.');
}
async function linkImage(connection: PoolConnection, userId: string, imageId: string, campaignId: string) {
  await connection.execute(`UPDATE imagens SET vinculo_tipo=NULL,vinculo_id=NULL WHERE proprietario_usuario_id=? AND finalidade='CAMPANHA' AND vinculo_tipo='CAMPANHA' AND vinculo_id=? AND id<>?`, [userId,campaignId,imageId]);
  const [result] = await connection.execute<ResultSetHeader>(`UPDATE imagens SET vinculo_tipo='CAMPANHA', vinculo_id=? WHERE id=? AND proprietario_usuario_id=? AND finalidade='CAMPANHA' AND (vinculo_id IS NULL OR (vinculo_tipo='CAMPANHA' AND vinculo_id=?))`, [campaignId, imageId, userId, campaignId]);
  if (!result.affectedRows) throw new AuthError(404, 'Imagem própria e disponível não encontrada.');
}
