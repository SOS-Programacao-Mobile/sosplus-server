import type { RowDataPacket } from 'mysql2';
import { database } from '../database/mysql.js';
import { currentUser } from '../auth/service.js';
import { AuthError } from '../auth/validation.js';
import { requireUserType } from '../auth/session.js';
import { validateOngAddress, validateOngProfile } from './validation.js';

type OngRow = RowDataPacket & {
  id: string; nome: string; descricao: string | null; ano_fundacao: number | null; telefone: string | null;
  foto_perfil: string | null; foto_capa: string | null; site: string | null; instagram: string | null; chave_pix?: string | null;
  cidade: string | null; estado: string | null;
};

async function ownProfileId(userId: string, lock = false): Promise<string> {
  const [rows] = await database.execute<(RowDataPacket & { id: string })[]>(
    `SELECT CAST(id AS CHAR) id FROM perfis_ong WHERE usuario_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [userId]
  );
  if (!rows[0]) throw new AuthError(404, 'ONG não encontrada.');
  return rows[0].id;
}

export async function categories() {
  const [rows] = await database.query<(RowDataPacket & { id: string; nome: string; descricao: string | null })[]>(
    'SELECT CAST(id AS CHAR) id, nome, descricao FROM categorias ORDER BY nome, id'
  );
  return rows;
}

export async function myOngProfile(token: string) {
  const user = requireUserType(await currentUser(token), 'ONG');
  const [rows] = await database.execute<OngRow[]>(`
    SELECT CAST(o.id AS CHAR) id, o.nome, o.descricao, o.ano_fundacao, o.telefone, o.foto_perfil, o.foto_capa,
      o.site, o.instagram, o.chave_pix, e.cidade, e.estado
    FROM perfis_ong o LEFT JOIN enderecos_ong e ON e.ong_id = o.id WHERE o.usuario_id = ? LIMIT 1`, [user.id]);
  if (!rows[0]) throw new AuthError(404, 'ONG não encontrada.');
  const ong = rows[0];
  return { ...profileData(ong), chavePix: ong.chave_pix, endereco: await addressFor(ong.id), categorias: await categoriesFor(ong.id) };
}

export async function updateOngProfile(token: string, body: unknown) {
  const user = requireUserType(await currentUser(token), 'ONG');
  const input = validateOngProfile(body);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [profiles] = await connection.query<(RowDataPacket & { id: string })[]>(
      'SELECT CAST(id AS CHAR) id FROM perfis_ong WHERE usuario_id = ? FOR UPDATE', [user.id]
    );
    if (!profiles[0]) throw new AuthError(404, 'ONG não encontrada.');
    const ongId = profiles[0].id;
    const placeholders = input.categoriaIds.map(() => '?').join(',');
    const [validCategories] = await connection.query<(RowDataPacket & { id: string })[]>(
      `SELECT CAST(id AS CHAR) id FROM categorias WHERE id IN (${placeholders})`, input.categoriaIds
    );
    if (validCategories.length !== input.categoriaIds.length) throw new AuthError(400, 'Uma ou mais categorias não existem.');
    for (const [imageId, purpose] of [[input.fotoPerfil, 'PERFIL_ONG'], [input.fotoCapa, 'CAPA_ONG']] as const) {
      if (imageId === undefined || imageId === null) continue;
      const [images] = await connection.execute<(RowDataPacket & { id: string })[]>(`
        SELECT CAST(id AS CHAR) id FROM imagens WHERE id = ? AND proprietario_usuario_id = ?
          AND finalidade = ? AND (vinculo_id IS NULL OR (vinculo_tipo = ? AND vinculo_id = ?)) FOR UPDATE`,
      [imageId, user.id, purpose, purpose, ongId]);
      if (!images.length) throw new AuthError(404, 'Imagem própria e disponível não encontrada.');
    }
    await connection.execute(`
      UPDATE perfis_ong SET descricao = ?, ano_fundacao = ?, telefone = ?, site = ?, instagram = ?, chave_pix = ?,
        foto_perfil = COALESCE(?, foto_perfil), foto_capa = COALESCE(?, foto_capa)
      WHERE usuario_id = ?`,
    [input.descricao, input.anoFundacao, input.telefone, input.site, input.instagram, input.chavePix,
      input.fotoPerfil ?? null, input.fotoCapa ?? null, user.id]);
    for (const [imageId, purpose, column] of [
      [input.fotoPerfil, 'PERFIL_ONG', 'foto_perfil'], [input.fotoCapa, 'CAPA_ONG', 'foto_capa'],
    ] as const) {
      if (imageId === undefined || imageId === null) continue;
      await connection.execute(`UPDATE imagens SET vinculo_tipo = NULL, vinculo_id = NULL
        WHERE proprietario_usuario_id = ? AND finalidade = ? AND vinculo_tipo = ? AND vinculo_id = ? AND id <> ?`,
      [user.id, purpose, purpose, ongId, imageId]);
      await connection.execute('UPDATE imagens SET vinculo_tipo = ?, vinculo_id = ? WHERE id = ?', [purpose, ongId, imageId]);
      await connection.execute(`UPDATE perfis_ong SET ${column} = ? WHERE usuario_id = ?`, [imageId, user.id]);
    }
    await connection.execute('DELETE FROM ong_categorias WHERE ong_id = ?', [ongId]);
    for (const categoryId of input.categoriaIds) {
      await connection.execute('INSERT INTO ong_categorias (ong_id, categoria_id) VALUES (?, ?)', [ongId, categoryId]);
    }
    await connection.commit();
    return myOngProfile(token);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function ongAddress(token: string) {
  const user = requireUserType(await currentUser(token), 'ONG');
  return addressFor(await ownProfileId(user.id));
}

export async function updateOngAddress(token: string, body: unknown) {
  const user = requireUserType(await currentUser(token), 'ONG');
  const input = validateOngAddress(body);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [profiles] = await connection.query<(RowDataPacket & { id: string })[]>(
      'SELECT CAST(id AS CHAR) id FROM perfis_ong WHERE usuario_id = ? FOR UPDATE', [user.id]
    );
    if (!profiles[0]) throw new AuthError(404, 'ONG não encontrada.');
    const [existing] = await connection.query<(RowDataPacket & { id: string })[]>(
      'SELECT CAST(id AS CHAR) id FROM enderecos_ong WHERE ong_id = ? FOR UPDATE', [profiles[0].id]
    );
    const values = [input.cep, input.logradouro, input.numero, input.complemento, input.bairro, input.cidade,
      input.estado, input.latitude, input.longitude];
    if (existing[0]) {
      await connection.execute(`UPDATE enderecos_ong SET cep=?, logradouro=?, numero=?, complemento=?, bairro=?, cidade=?, estado=?, latitude=?, longitude=? WHERE id=?`,
        [...values, existing[0].id]);
    } else {
      await connection.execute(`INSERT INTO enderecos_ong (cep, logradouro, numero, complemento, bairro, cidade, estado, latitude, longitude, ong_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [...values, profiles[0].id]);
    }
    await connection.commit();
    return addressFor(profiles[0].id);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function ongCatalog(query: { limit?: unknown; cursor?: unknown; categoryId?: unknown }) {
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AuthError(400, 'Limite de página inválido.');
  const cursor = query.cursor === undefined ? null : String(query.cursor);
  if (cursor !== null && !/^\d+$/.test(cursor)) throw new AuthError(400, 'Continuação inválida.');
  const categoryId = query.categoryId === undefined ? null : String(query.categoryId);
  if (categoryId !== null && !/^\d+$/.test(categoryId)) throw new AuthError(400, 'Categoria inválida.');
  const conditions = ['u.ativo = 1'];
  const params: Array<string | number> = [];
  if (cursor) { conditions.push('o.id < ?'); params.push(cursor); }
  if (categoryId) {
    conditions.push('EXISTS (SELECT 1 FROM ong_categorias oc WHERE oc.ong_id = o.id AND oc.categoria_id = ?)');
    params.push(categoryId);
  }
  params.push(limit + 1);
  const [rows] = await database.execute<OngRow[]>(`
    SELECT CAST(o.id AS CHAR) id, o.nome, o.descricao, o.ano_fundacao, o.telefone, o.foto_perfil, o.foto_capa,
      o.site, o.instagram, e.cidade, e.estado
    FROM perfis_ong o JOIN usuarios u ON u.id = o.usuario_id
    LEFT JOIN enderecos_ong e ON e.ong_id = o.id
    WHERE ${conditions.join(' AND ')} ORDER BY o.id DESC LIMIT ?`, params);
  const more = rows.length > limit;
  const visible = rows.slice(0, limit);
  const ids = visible.map((row) => row.id);
  const categoriesByOng = await categoriesForMany(ids);
  return {
    resultados: visible.map((row) => ({ ...profileData(row), categorias: categoriesByOng.get(row.id) ?? [] })),
    continuacao: more ? visible.at(-1)?.id ?? null : null,
  };
}

export async function mapOngs() {
  const [rows] = await database.query<(RowDataPacket & {
    id: string; nome: string; latitude: number | string; longitude: number | string;
  })[]>(`
    SELECT CAST(o.id AS CHAR) id, o.nome, e.latitude, e.longitude
    FROM perfis_ong o JOIN usuarios u ON u.id = o.usuario_id AND u.ativo = 1
    JOIN enderecos_ong e ON e.ong_id = o.id
    WHERE e.latitude IS NOT NULL AND e.longitude IS NOT NULL
    ORDER BY o.id DESC LIMIT 1000`);
  const categoriesByOng = await categoriesForMany(rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id, nome: row.nome, latitude: Number(row.latitude), longitude: Number(row.longitude),
    categorias: categoriesByOng.get(row.id) ?? [],
  }));
}

export async function publicOngProfile(id: string, token?: string) {
  if (!/^\d+$/.test(id)) throw new AuthError(404, 'ONG não encontrada.');
  const [rows] = await database.execute<OngRow[]>(`
    SELECT CAST(o.id AS CHAR) id, o.nome, o.descricao, o.ano_fundacao, o.telefone, o.foto_perfil, o.foto_capa,
      o.site, o.instagram, e.cidade, e.estado
    FROM perfis_ong o JOIN usuarios u ON u.id = o.usuario_id AND u.ativo = 1
    LEFT JOIN enderecos_ong e ON e.ong_id = o.id WHERE o.id = ? LIMIT 1`, [id]);
  if (!rows[0]) throw new AuthError(404, 'ONG não encontrada.');
  const [campaigns] = await database.execute<(RowDataPacket & Record<string, unknown>)[]>(`
    SELECT CAST(c.id AS CHAR) id, CAST(c.categoria_id AS CHAR) categoria_id, cat.nome categoria_nome,
      c.titulo, c.descricao, c.meta_valor, c.data_inicio, c.data_fim, c.status, c.imagem,
      COALESCE(SUM(CASE WHEN d.status = 'CONFIRMADA' THEN d.valor ELSE 0 END), 0) arrecadado
    FROM campanhas c JOIN categorias cat ON cat.id = c.categoria_id
    LEFT JOIN doacoes d ON d.campanha_id = c.id
    WHERE c.ong_id = ? AND c.status = 'ATIVA' AND CURDATE() BETWEEN c.data_inicio AND c.data_fim
    GROUP BY c.id, cat.id ORDER BY c.criado_em DESC, c.id DESC`, [id]);
  const [followerCount] = await database.execute<(RowDataPacket & { total: number })[]>(
    'SELECT COUNT(*) total FROM seguidores_ong WHERE ong_id = ?', [id]
  );
  let following = false;
  if (token) {
    const user = await currentUser(token);
    if (user.tipo === 'DOADOR') {
      const donorId = await ownDonorProfileId(user.id);
      const [relation] = await database.execute<RowDataPacket[]>('SELECT 1 FROM seguidores_ong WHERE doador_id=? AND ong_id=?', [donorId,id]);
      following = relation.length > 0;
    }
  }
  return {
    ...profileData(rows[0]),
    endereco: await addressFor(id),
    categorias: await categoriesFor(id),
    seguidores: Number(followerCount[0]?.total ?? 0),
    seguindo: following,
    campanhas: campaigns.map((campaign) => ({
      id: campaign.id, ongId: id, ongNome: rows[0].nome,
      categoria: { id: campaign.categoria_id, nome: campaign.categoria_nome },
      titulo: campaign.titulo, descricao: campaign.descricao,
      metaCentavos: decimalToCents(String(campaign.meta_valor)),
      arrecadadoCentavos: decimalToCents(String(campaign.arrecadado)),
      inicioEm: campaign.data_inicio, fimEm: campaign.data_fim, status: campaign.status,
      imagemId: campaign.imagem,
    })),
  };
}

async function ownDonorProfileId(userId: string) {
  const [rows] = await database.execute<(RowDataPacket & { id: string })[]>(
    'SELECT CAST(id AS CHAR) id FROM perfis_doador WHERE usuario_id=? LIMIT 1', [userId]);
  if (!rows[0]) throw new AuthError(404, 'Perfil de doador não encontrado.');
  return rows[0].id;
}

function profileData(row: OngRow) {
  return {
    id: row.id, nome: row.nome, descricao: row.descricao, anoFundacao: row.ano_fundacao,
    telefone: row.telefone, fotoPerfil: row.foto_perfil, fotoCapa: row.foto_capa, site: row.site,
    instagram: row.instagram,
    enderecoResumo: row.cidade && row.estado ? { cidade: row.cidade, estado: row.estado } : null,
  };
}

async function addressFor(ongId: string) {
  const [rows] = await database.execute<(RowDataPacket & Record<string, unknown>)[]>(`
    SELECT cep, logradouro, numero, complemento, bairro, cidade, estado, latitude, longitude
    FROM enderecos_ong WHERE ong_id = ? LIMIT 1`, [ongId]);
  const row = rows[0];
  return row ? {
    cep: row.cep, logradouro: row.logradouro, numero: row.numero, complemento: row.complemento,
    bairro: row.bairro, cidade: row.cidade, estado: row.estado,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
  } : null;
}

async function categoriesFor(ongId: string) {
  const [rows] = await database.execute<(RowDataPacket & { id: string; nome: string })[]>(`
    SELECT CAST(c.id AS CHAR) id, c.nome FROM ong_categorias oc JOIN categorias c ON c.id = oc.categoria_id
    WHERE oc.ong_id = ? ORDER BY c.nome, c.id`, [ongId]);
  return rows;
}

async function categoriesForMany(ongIds: string[]) {
  const result = new Map<string, Array<{ id: string; nome: string }>>();
  if (!ongIds.length) return result;
  const [rows] = await database.execute<(RowDataPacket & { ong_id: string; id: string; nome: string })[]>(`
    SELECT CAST(oc.ong_id AS CHAR) ong_id, CAST(c.id AS CHAR) id, c.nome
    FROM ong_categorias oc JOIN categorias c ON c.id = oc.categoria_id
    WHERE oc.ong_id IN (${ongIds.map(() => '?').join(',')}) ORDER BY c.nome, c.id`, ongIds);
  for (const row of rows) result.set(row.ong_id, [...(result.get(row.ong_id) ?? []), { id: row.id, nome: row.nome }]);
  return result;
}

function decimalToCents(value: string): number {
  const [whole, fraction = '00'] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
}
