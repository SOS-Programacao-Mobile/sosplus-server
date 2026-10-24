import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { database } from '../database/mysql.js';
import { currentUser } from '../auth/service.js';
import { AuthError } from '../auth/validation.js';
import { requireUserType } from '../auth/session.js';
import { validatePublication } from './validation.js';

type PublicationRow = RowDataPacket & {
  id: string; ong_id: string; ong_nome: string; texto: string; campanha_id: string | null;
  campanha_titulo: string | null; imagem: string | null; criado_em: string | Date;
};

export async function setFollow(token: string, ongId: string, follow: boolean) {
  const user = requireUserType(await currentUser(token), 'DOADOR');
  if (!/^\d+$/.test(ongId)) throw new AuthError(404, 'ONG não encontrada.');
  const [ongs] = await database.execute<RowDataPacket[]>(`SELECT 1 FROM perfis_ong o JOIN usuarios u ON u.id=o.usuario_id AND u.ativo=1 WHERE o.id=?`, [ongId]);
  if (!ongs.length) throw new AuthError(404, 'ONG não encontrada.');
  const donorId = await profileId(user.id, 'perfis_doador');
  if (follow) await database.execute('INSERT IGNORE INTO seguidores_ong (doador_id,ong_id) VALUES (?,?)', [donorId,ongId]);
  else await database.execute('DELETE FROM seguidores_ong WHERE doador_id=? AND ong_id=?', [donorId,ongId]);
  return { ongId, seguindo: follow };
}

export async function createPublication(token: string, body: unknown) {
  const user = requireUserType(await currentUser(token), 'ONG');
  const input = validatePublication(body);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const ongId = await profileId(user.id, 'perfis_ong', connection, true);
    if (input.campaignId) {
      const [campaigns] = await connection.execute<RowDataPacket[]>(
        'SELECT 1 FROM campanhas WHERE id=? AND ong_id=?', [input.campaignId,ongId]);
      if (!campaigns.length) throw new AuthError(404, 'Campanha própria não encontrada.');
    }
    if (input.imageId) await assertImage(connection,user.id,input.imageId);
    const [result] = await connection.execute<ResultSetHeader>(`INSERT INTO publicacoes (ong_id,campanha_id,texto,imagem)
      VALUES (?,?,?,?)`, [ongId,input.campaignId,input.texto,input.imageId]);
    if (input.imageId) await linkImage(connection,user.id,input.imageId,String(result.insertId));
    await connection.commit();
    return publicationById(String(result.insertId));
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function followedFeed(token: string, cursorValue?: unknown, limitValue?: unknown) {
  const user = requireUserType(await currentUser(token), 'DOADOR');
  const limit = limitValue === undefined ? 20 : Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AuthError(400, 'Limite de página inválido.');
  const cursor = decodeCursor(cursorValue);
  const donorId = await profileId(user.id, 'perfis_doador');
  const where = ['s.doador_id=?','u.ativo=1']; const params: unknown[] = [donorId];
  if (cursor) { where.push('(b.criado_em < ? OR (b.criado_em = ? AND b.id < ?))'); params.push(cursor.createdAt,cursor.createdAt,cursor.id); }
  const [rows] = await database.execute<PublicationRow[]>(`${publicationSelect} JOIN seguidores_ong s ON s.ong_id=o.id
    WHERE ${where.join(' AND ')} ORDER BY b.criado_em DESC,b.id DESC LIMIT ?`, [...params,limit+1] as never[]);
  const hasMore = rows.length > limit; const page = rows.slice(0,limit); const last = page.at(-1);
  return { resultados: page.map(toPublication), continuacao: hasMore && last ? encodeCursor({ createdAt: dateTime(last.criado_em), id: String(last.id) }) : null };
}

export async function myPublications(token: string) {
  const user = requireUserType(await currentUser(token), 'ONG');
  const [rows] = await database.execute<PublicationRow[]>(`${publicationSelect} WHERE o.usuario_id=? ORDER BY b.criado_em DESC,b.id DESC`, [user.id]);
  return rows.map(toPublication);
}

export async function ongDashboard(token: string) {
  const user = requireUserType(await currentUser(token), 'ONG');
  const [rows] = await database.execute<(RowDataPacket & { ativas: number; encerradas: number; confirmadas: number; arrecadado: string })[]>(`
    SELECT COUNT(DISTINCT CASE WHEN c.status='ATIVA' AND c.data_inicio<=? AND c.data_fim>=? THEN c.id END) ativas,
      COUNT(DISTINCT CASE WHEN c.status='ENCERRADA' OR (c.status='ATIVA' AND c.data_fim<?) THEN c.id END) encerradas,
      COUNT(DISTINCT CASE WHEN d.status='CONFIRMADA' THEN d.id END) confirmadas,
      COALESCE(SUM(CASE WHEN d.status='CONFIRMADA' THEN d.valor ELSE 0 END),0) arrecadado
    FROM perfis_ong p LEFT JOIN campanhas c ON c.ong_id=p.id
    LEFT JOIN doacoes d ON d.campanha_id=c.id WHERE p.usuario_id=?`, [localDate(),localDate(),localDate(),user.id]);
  const ano = Number(localDate().slice(0, 4));
  const [mensal] = await database.execute<(RowDataPacket & { mes: number; doacoes: number; arrecadado: string })[]>(`
    SELECT MONTH(d.data_doacao) mes, COUNT(d.id) doacoes, COALESCE(SUM(d.valor),0) arrecadado
    FROM perfis_ong p JOIN campanhas c ON c.ong_id=p.id
    JOIN doacoes d ON d.campanha_id=c.id AND d.status='CONFIRMADA'
    WHERE p.usuario_id=? AND d.data_doacao>=? AND d.data_doacao<?
    GROUP BY MONTH(d.data_doacao) ORDER BY mes`, [user.id, `${ano}-01-01`, `${ano + 1}-01-01`]);
  const [campanhasAno] = await database.execute<(RowDataPacket & { total: number })[]>(`
    SELECT COUNT(c.id) total FROM perfis_ong p JOIN campanhas c ON c.ong_id=p.id
    WHERE p.usuario_id=? AND c.criado_em>=? AND c.criado_em<?`, [user.id, `${ano}-01-01`, `${ano + 1}-01-01`]);
  const row=rows[0];
  return { campanhasAtivas:Number(row?.ativas??0), campanhasEncerradas:Number(row?.encerradas??0),
    doacoesConfirmadas:Number(row?.confirmadas??0), arrecadadoCentavos:decimalToCents(String(row?.arrecadado??'0')),
    ano, campanhasNoAno:Number(campanhasAno[0]?.total??0),
    arrecadacaoMensal:mensal.map(item => ({ mes:Number(item.mes), doacoes:Number(item.doacoes), arrecadadoCentavos:decimalToCents(String(item.arrecadado)) })) };
}

export async function publicationById(id: string) {
  if (!/^\d+$/.test(id)) throw new AuthError(404, 'Publicação não encontrada.');
  const [rows] = await database.execute<PublicationRow[]>(`${publicationSelect} WHERE b.id=? AND u.ativo=1 LIMIT 1`,[id]);
  if (!rows[0]) throw new AuthError(404,'Publicação não encontrada.');
  return toPublication(rows[0]);
}

const publicationSelect = `SELECT CAST(b.id AS CHAR) id,CAST(o.id AS CHAR) ong_id,o.nome ong_nome,b.texto,
  CAST(b.campanha_id AS CHAR) campanha_id,c.titulo campanha_titulo,CAST(b.imagem AS CHAR) imagem,b.criado_em
  FROM publicacoes b JOIN perfis_ong o ON o.id=b.ong_id JOIN usuarios u ON u.id=o.usuario_id
  LEFT JOIN campanhas c ON c.id=b.campanha_id`;
function toPublication(row: PublicationRow) {
  return { id:String(row.id), ongId:String(row.ong_id), ongNome:row.ong_nome, texto:row.texto,
    campanhaId:row.campanha_id, campanhaTitulo:row.campanha_titulo, imagemId:row.imagem,
    criadaEm:row.criado_em instanceof Date?row.criado_em.toISOString():String(row.criado_em) };
}
async function profileId(userId:string,table:'perfis_ong'|'perfis_doador',connection:PoolConnection|typeof database=database,lock=false) {
  const [rows]=await connection.execute<(RowDataPacket&{id:string})[]>(`SELECT CAST(id AS CHAR) id FROM ${table} WHERE usuario_id=?${lock?' FOR UPDATE':''}`,[userId]);
  if(!rows[0]) throw new AuthError(404,'Perfil não encontrado.'); return rows[0].id;
}
async function assertImage(connection:PoolConnection,userId:string,imageId:string) {
  const [rows]=await connection.execute<RowDataPacket[]>(`SELECT 1 FROM imagens WHERE id=? AND proprietario_usuario_id=? AND finalidade='PUBLICACAO' AND vinculo_id IS NULL FOR UPDATE`,[imageId,userId]);
  if(!rows.length) throw new AuthError(404,'Imagem própria e disponível não encontrada.');
}
async function linkImage(connection:PoolConnection,userId:string,imageId:string,publicationId:string) {
  const [result]=await connection.execute<ResultSetHeader>(`UPDATE imagens SET vinculo_tipo='PUBLICACAO',vinculo_id=? WHERE id=? AND proprietario_usuario_id=? AND finalidade='PUBLICACAO' AND vinculo_id IS NULL`,[publicationId,imageId,userId]);
  if(!result.affectedRows) throw new AuthError(404,'Imagem própria e disponível não encontrada.');
}
function decodeCursor(value:unknown):{createdAt:string;id:string}|null {
  if(value===undefined||value===null||value==='') return null;
  if(typeof value!=='string') throw new AuthError(400,'Continuação inválida.');
  try { const parsed=JSON.parse(Buffer.from(value,'base64url').toString('utf8')) as Record<string,unknown>;
    if(typeof parsed.createdAt!=='string'||typeof parsed.id!=='string'||!/^\d+$/.test(parsed.id)) throw new Error();
    return {createdAt:parsed.createdAt,id:parsed.id};
  } catch { throw new AuthError(400,'Continuação inválida.'); }
}
function encodeCursor(cursor:{createdAt:string;id:string}) { return Buffer.from(JSON.stringify(cursor)).toString('base64url'); }
function dateTime(value:string|Date) { return value instanceof Date?value.toISOString().replace('T',' ').slice(0,23):String(value); }
function localDate() {
  const values=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts();
  return `${values.find(x=>x.type==='year')?.value}-${values.find(x=>x.type==='month')?.value}-${values.find(x=>x.type==='day')?.value}`;
}
function decimalToCents(value:string) { const [units,cents='00']=value.split('.'); return Number(units)*100+Number(cents.padEnd(2,'0').slice(0,2)); }
