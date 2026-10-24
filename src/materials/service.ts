import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { database } from '../database/mysql.js';
import { currentUser } from '../auth/service.js';
import { AuthError } from '../auth/validation.js';
import { requireUserType } from '../auth/session.js';
import { validateItemDonation, validateItemStatus, validateNeed, validateNeedStatus } from './validation.js';

type NeedRow = RowDataPacket & {
  id: string; ong_id: string; ong_nome: string; categoria_id: string; categoria_nome: string;
  titulo: string; descricao: string; tipo: string; quantidade: string; unidade: string;
  imagem: string | null; status: string; criado_em: string | Date;
  entregue?: string; reservado?: string;
};
type ItemRow = RowDataPacket & {
  id: string; necessidade_id: string; titulo: string; ong_id: string; ong_nome: string;
  doador_id: string; doador_nome: string; quantidade: string; observacao: string | null;
  foto: string | null; forma_entrega: string; data_entrega: string | Date | null; status: string;
  criado_em: string | Date;
};

export async function activeNeeds(query: { categoriaId?: unknown; cidade?: unknown; estado?: unknown }) {
  const where = ["n.status = 'ATIVA'", 'u.ativo = 1'];
  const params: unknown[] = [];
  if (query.categoriaId !== undefined) {
    const category = String(query.categoriaId);
    if (!/^\d+$/.test(category)) throw new AuthError(400, 'Categoria inválida.');
    where.push('n.categoria_id = ?'); params.push(category);
  }
  const city = typeof query.cidade === 'string' ? query.cidade.trim() : '';
  const state = typeof query.estado === 'string' ? query.estado.trim() : '';
  if (city) { where.push('e.cidade = ?'); params.push(city); }
  if (state) { where.push('e.estado = ?'); params.push(state); }
  const [rows] = await database.execute<NeedRow[]>(`${needSelect}
    LEFT JOIN enderecos_ong e ON e.ong_id = p.id
    WHERE ${where.join(' AND ')} GROUP BY n.id, p.id, cat.id ORDER BY n.criado_em DESC, n.id DESC`, params as never[]);
  return rows.map(toNeed);
}

export async function myNeeds(token: string) {
  const user = requireUserType(await currentUser(token), 'ONG');
  const [rows] = await database.execute<NeedRow[]>(`${needSelect}
    WHERE p.usuario_id = ? GROUP BY n.id, p.id, cat.id ORDER BY n.criado_em DESC, n.id DESC`, [user.id]);
  return rows.map(toNeed);
}

export async function needById(id: string, token?: string) {
  if (!/^\d+$/.test(id)) throw new AuthError(404, 'Necessidade não encontrada.');
  const [rows] = await database.execute<NeedRow[]>(`${needSelect} WHERE n.id = ? AND u.ativo=1 GROUP BY n.id, p.id, cat.id LIMIT 1`, [id]);
  if (!rows[0]) throw new AuthError(404, 'Necessidade não encontrada.');
  if (rows[0].status === 'CANCELADA') {
    if (!token) throw new AuthError(404, 'Necessidade não encontrada.');
    const user = await currentUser(token);
    const [owner] = user.tipo === 'ONG'
      ? await database.execute<RowDataPacket[]>('SELECT 1 FROM perfis_ong WHERE id=? AND usuario_id=?', [rows[0].ong_id, user.id])
      : await database.execute<RowDataPacket[]>(`SELECT 1 FROM doacoes_itens d JOIN perfis_doador p ON p.id=d.doador_id WHERE d.necessidade_id=? AND p.usuario_id=? LIMIT 1`, [id, user.id]);
    if (!owner.length) throw new AuthError(404, 'Necessidade não encontrada.');
  }
  return toNeed(rows[0]);
}

export async function createNeed(token: string, body: unknown) {
  const user = requireUserType(await currentUser(token), 'ONG');
  const input = validateNeed(body);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [profiles] = await connection.execute<(RowDataPacket & { id: string })[]>(
      'SELECT CAST(id AS CHAR) id FROM perfis_ong WHERE usuario_id=? FOR UPDATE', [user.id]);
    if (!profiles[0]) throw new AuthError(404, 'ONG não encontrada.');
    const [categories] = await connection.execute<RowDataPacket[]>('SELECT id FROM categorias WHERE id=?', [input.categoriaId]);
    if (!categories.length) throw new AuthError(400, 'Categoria não encontrada.');
    await assertImage(connection, user.id, input.imagemId, 'NECESSIDADE');
    const [result] = await connection.execute<ResultSetHeader>(`INSERT INTO necessidades
      (ong_id,categoria_id,titulo,descricao,tipo,quantidade,unidade,imagem)
      VALUES (?,?,?,?,?,?,?,?)`, [profiles[0].id, input.categoriaId, input.titulo, input.descricao,
      input.tipo, input.quantidade, input.unidade, input.imagemId]);
    if (input.imagemId) await linkImage(connection, user.id, input.imagemId, 'NECESSIDADE', String(result.insertId));
    await connection.commit();
    return needById(String(result.insertId), token);
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function changeNeedStatus(token: string, id: string, body: unknown) {
  const user = requireUserType(await currentUser(token), 'ONG');
  validateNeedStatus(body);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [needs] = await connection.execute<(RowDataPacket & { status: string })[]>(`SELECT n.status FROM necessidades n
      JOIN perfis_ong p ON p.id=n.ong_id WHERE n.id=? AND p.usuario_id=? FOR UPDATE`, [id, user.id]);
    if (!needs[0]) throw new AuthError(404, 'Necessidade não encontrada.');
    if (needs[0].status === 'CANCELADA') { await connection.commit(); return needById(id, token); }
    if (needs[0].status !== 'ATIVA') throw new AuthError(409, 'Somente necessidades ativas podem ser canceladas.');
    await connection.execute("UPDATE necessidades SET status='CANCELADA' WHERE id=?", [id]);
    await connection.execute("UPDATE doacoes_itens SET status='CANCELADA' WHERE necessidade_id=? AND status IN ('PENDENTE','ACEITA')", [id]);
    await connection.commit();
    return needById(id, token);
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function createItemDonation(token: string, body: unknown) {
  const user = requireUserType(await currentUser(token), 'DOADOR');
  const input = validateItemDonation(body);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const donorId = await profileId(connection, 'perfis_doador', user.id);
    const [needs] = await connection.execute<(RowDataPacket & { status: string })[]>(
      'SELECT n.status FROM necessidades n JOIN perfis_ong p ON p.id=n.ong_id JOIN usuarios u ON u.id=p.usuario_id AND u.ativo=1 WHERE n.id=? FOR UPDATE', [input.needId]);
    if (!needs[0] || needs[0].status !== 'ATIVA') throw new AuthError(409, 'Esta necessidade não está disponível.');
    await assertImage(connection, user.id, input.imagemId, 'DOACAO_ITEM');
    const [result] = await connection.execute<ResultSetHeader>(`INSERT INTO doacoes_itens
      (doador_id,necessidade_id,quantidade,observacao,foto,forma_entrega,data_entrega)
      VALUES (?,?,?,?,?,?,?)`, [donorId, input.needId, input.quantidade, input.observacao, input.imagemId,
      input.formaEntrega, input.dataEntrega]);
    if (input.imagemId) await linkImage(connection, user.id, input.imagemId, 'DOACAO_ITEM', String(result.insertId));
    await connection.commit();
    return itemDonationById(token, String(result.insertId));
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function donorItemDonations(token: string) {
  const user = requireUserType(await currentUser(token), 'DOADOR');
  const donorId = await profileId(database, 'perfis_doador', user.id);
  const [rows] = await database.execute<ItemRow[]>(`${itemSelect} WHERE d.doador_id=? ORDER BY d.criado_em DESC,d.id DESC`, [donorId]);
  return rows.map(toItemDonation);
}

export async function incomingItemDonations(token: string) {
  const user = requireUserType(await currentUser(token), 'ONG');
  const [rows] = await database.execute<ItemRow[]>(`${itemSelect} WHERE op.usuario_id=? ORDER BY d.criado_em DESC,d.id DESC`, [user.id]);
  return rows.map(toItemDonation);
}

export async function itemDonationById(token: string, id: string) {
  const user = await currentUser(token);
  if (!/^\d+$/.test(id)) throw new AuthError(404, 'Intenção não encontrada.');
  const [rows] = user.tipo === 'DOADOR'
    ? await database.execute<ItemRow[]>(`${itemSelect} WHERE d.id=? AND pd.usuario_id=? LIMIT 1`, [id, user.id])
    : await database.execute<ItemRow[]>(`${itemSelect} WHERE d.id=? AND op.usuario_id=? LIMIT 1`, [id, user.id]);
  if (!rows[0]) throw new AuthError(404, 'Intenção não encontrada.');
  return toItemDonation(rows[0]);
}

export async function changeItemDonationStatus(token: string, id: string, body: unknown) {
  const user = await currentUser(token);
  const input = validateItemStatus(body);
  if (!/^\d+$/.test(id)) throw new AuthError(404, 'Intenção não encontrada.');
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [links] = await connection.execute<(RowDataPacket & { necessidade_id: string })[]>(
      'SELECT CAST(necessidade_id AS CHAR) necessidade_id FROM doacoes_itens WHERE id=?', [id]);
    if (!links[0]) throw new AuthError(404, 'Intenção não encontrada.');
    const [needs] = await connection.execute<(RowDataPacket & { status: string; quantidade: string })[]>(
      'SELECT status, quantidade FROM necessidades WHERE id=? FOR UPDATE', [links[0].necessidade_id]);
    const [items] = await connection.execute<(RowDataPacket & { status: string; quantidade: string; doador_id: string; ong_usuario_id: string })[]>(`SELECT d.status,d.quantidade,CAST(d.doador_id AS CHAR) doador_id,CAST(p.usuario_id AS CHAR) ong_usuario_id
      FROM doacoes_itens d JOIN necessidades n ON n.id=d.necessidade_id JOIN perfis_ong p ON p.id=n.ong_id
      WHERE d.id=? FOR UPDATE`, [id]);
    const item = items[0]; const need = needs[0];
    if (!item || !need) throw new AuthError(404, 'Intenção não encontrada.');
    const donorId = user.tipo === 'DOADOR' ? await profileId(connection, 'perfis_doador', user.id) : null;
    const isDonor = donorId === item.doador_id;
    const isOng = user.tipo === 'ONG' && user.id === item.ong_usuario_id;
    if (input.status === 'CANCELADA') {
      if (!isDonor && !isOng) throw new AuthError(404, 'Intenção não encontrada.');
      if (item.status === 'CANCELADA') { await connection.commit(); return itemDonationById(token, id); }
      if (item.status === 'ENTREGUE') throw new AuthError(409, 'Uma entrega concluída não pode ser cancelada.');
      await connection.execute("UPDATE doacoes_itens SET status='CANCELADA' WHERE id=?", [id]);
    } else {
      if (!isOng) throw new AuthError(404, 'Intenção não encontrada.');
      if (input.status === 'ACEITA') {
        if (item.status === 'ACEITA') { await connection.commit(); return itemDonationById(token, id); }
        if (need.status !== 'ATIVA') throw new AuthError(409, 'A necessidade foi encerrada.');
        if (item.status !== 'PENDENTE') throw new AuthError(409, 'Somente intenções pendentes podem ser aceitas.');
        const [allocated] = await connection.execute<(RowDataPacket & { quantidade: string })[]>(`SELECT CAST(quantidade AS CHAR) quantidade
          FROM doacoes_itens WHERE necessidade_id=? AND status IN ('ACEITA','ENTREGUE') ORDER BY id FOR UPDATE`, [links[0].necessidade_id]);
        const reservedUnits = allocated.reduce((sum, row) => sum + quantityUnits(row.quantidade), 0);
        if (reservedUnits + quantityUnits(item.quantidade) > quantityUnits(need.quantidade)) {
          throw new AuthError(409, 'A quantidade solicitada já foi reservada ou entregue.');
        }
        await connection.execute("UPDATE doacoes_itens SET status='ACEITA' WHERE id=?", [id]);
      } else {
        if (item.status === 'ENTREGUE') { await connection.commit(); return itemDonationById(token, id); }
        if (need.status !== 'ATIVA') throw new AuthError(409, 'A necessidade foi encerrada.');
        if (item.status !== 'ACEITA') throw new AuthError(409, 'Somente intenções aceitas podem ser marcadas como entregues.');
        await connection.execute("UPDATE doacoes_itens SET status='ENTREGUE', data_entrega=COALESCE(?, data_entrega, CURRENT_TIMESTAMP(3)) WHERE id=?", [input.dataEntrega, id]);
        const [delivered] = await connection.execute<(RowDataPacket & { quantidade: string })[]>("SELECT CAST(quantidade AS CHAR) quantidade FROM doacoes_itens WHERE necessidade_id=? AND status='ENTREGUE' ORDER BY id FOR UPDATE", [links[0].necessidade_id]);
        if (delivered.reduce((sum,row) => sum + quantityUnits(row.quantidade),0) >= quantityUnits(need.quantidade)) {
          await connection.execute("UPDATE necessidades SET status='ATENDIDA' WHERE id=? AND status='ATIVA'", [links[0].necessidade_id]);
          await connection.execute("UPDATE doacoes_itens SET status='CANCELADA' WHERE necessidade_id=? AND status IN ('PENDENTE','ACEITA')", [links[0].necessidade_id]);
        }
      }
    }
    await connection.commit();
    return itemDonationById(token, id);
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

const needSelect = `SELECT CAST(n.id AS CHAR) id, CAST(n.ong_id AS CHAR) ong_id, p.nome ong_nome,
  CAST(cat.id AS CHAR) categoria_id, cat.nome categoria_nome, n.titulo,n.descricao,n.tipo,
  CAST(n.quantidade AS CHAR) quantidade,n.unidade, CAST(n.imagem AS CHAR) imagem,n.status,n.criado_em,
  CAST(COALESCE(SUM(CASE WHEN d.status='ENTREGUE' THEN d.quantidade ELSE 0 END),0) AS CHAR) entregue,
  CAST(COALESCE(SUM(CASE WHEN d.status='ACEITA' THEN d.quantidade ELSE 0 END),0) AS CHAR) reservado
  FROM necessidades n JOIN perfis_ong p ON p.id=n.ong_id JOIN usuarios u ON u.id=p.usuario_id
  JOIN categorias cat ON cat.id=n.categoria_id LEFT JOIN doacoes_itens d ON d.necessidade_id=n.id`;
const itemSelect = `SELECT CAST(d.id AS CHAR) id, CAST(d.necessidade_id AS CHAR) necessidade_id,n.titulo,
  CAST(n.ong_id AS CHAR) ong_id,op.nome ong_nome,CAST(d.doador_id AS CHAR) doador_id,pd.nome doador_nome,
  CAST(d.quantidade AS CHAR) quantidade,d.observacao,CAST(d.foto AS CHAR) foto,d.forma_entrega,
  d.data_entrega,d.status,d.criado_em
  FROM doacoes_itens d JOIN necessidades n ON n.id=d.necessidade_id JOIN perfis_ong op ON op.id=n.ong_id
  JOIN perfis_doador pd ON pd.id=d.doador_id`;

function toNeed(row: NeedRow) {
  const requested = quantityUnits(row.quantidade), delivered = quantityUnits(row.entregue ?? '0'), reserved = quantityUnits(row.reservado ?? '0');
  return { id: String(row.id), ongId: String(row.ong_id), ongNome: row.ong_nome,
    categoria: { id: String(row.categoria_id), nome: row.categoria_nome }, titulo: row.titulo, descricao: row.descricao,
    tipo: row.tipo, quantidade: unitsDecimal(requested), unidade: row.unidade, imagemId: row.imagem,
    status: row.status, entregue: unitsDecimal(delivered), reservado: unitsDecimal(reserved),
    restante: unitsDecimal(Math.max(requested - delivered, 0)),
    disponivel: unitsDecimal(Math.max(requested - delivered - reserved, 0)),
    criadaEm: row.criado_em instanceof Date ? row.criado_em.toISOString() : String(row.criado_em) };
}
function toItemDonation(row: ItemRow) {
  return { id: String(row.id), necessidadeId: String(row.necessidade_id), necessidadeTitulo: row.titulo,
    ongId: String(row.ong_id), ongNome: row.ong_nome, doadorId: String(row.doador_id), doadorNome: row.doador_nome,
    quantidade: unitsDecimal(quantityUnits(row.quantidade)), observacao: row.observacao, imagemId: row.foto,
    formaEntrega: row.forma_entrega, dataEntrega: row.data_entrega instanceof Date ? row.data_entrega.toISOString() : row.data_entrega,
    status: row.status, criadaEm: row.criado_em instanceof Date ? row.criado_em.toISOString() : String(row.criado_em) };
}
function quantityUnits(value: string | number): number {
  const [whole, fraction=''] = String(value).split('.');
  const units = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0,2));
  if (!Number.isSafeInteger(units)) throw new AuthError(400, 'Quantidade fora do limite.');
  return units;
}
function unitsDecimal(units: number): string { return `${Math.floor(units / 100)}.${String(units % 100).padStart(2,'0')}`; }
async function profileId(connection: PoolConnection | typeof database, table: 'perfis_ong'|'perfis_doador', userId: string) {
  const [rows] = await connection.execute<(RowDataPacket & { id: string })[]>(`SELECT CAST(id AS CHAR) id FROM ${table} WHERE usuario_id=? LIMIT 1`, [userId]);
  if (!rows[0]) throw new AuthError(404, 'Perfil não encontrado.');
  return rows[0].id;
}
async function assertImage(connection: PoolConnection, userId: string, imageId: string | null, purpose: 'NECESSIDADE'|'DOACAO_ITEM') {
  if (!imageId) return;
  const [rows] = await connection.execute<RowDataPacket[]>(`SELECT id FROM imagens WHERE id=? AND proprietario_usuario_id=? AND finalidade=? AND vinculo_id IS NULL FOR UPDATE`, [imageId,userId,purpose]);
  if (!rows.length) throw new AuthError(404, 'Imagem própria e disponível não encontrada.');
}
async function linkImage(connection: PoolConnection, userId: string, imageId: string, purpose: 'NECESSIDADE'|'DOACAO_ITEM', id: string) {
  const [result] = await connection.execute<ResultSetHeader>(`UPDATE imagens SET vinculo_tipo=?,vinculo_id=? WHERE id=? AND proprietario_usuario_id=? AND finalidade=? AND vinculo_id IS NULL`, [purpose,id,imageId,userId,purpose]);
  if (!result.affectedRows) throw new AuthError(404, 'Imagem própria e disponível não encontrada.');
}
