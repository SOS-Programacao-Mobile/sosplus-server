import { createHash, randomBytes } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { database } from '../database/mysql.js';
import { decryptPersonalData, encryptPersonalData } from '../security/personal-data.js';
import { dummyHash, hashPassword, verifyPassword } from './password.js';
import { AuthError, validateLogin, validatePasswordUpdate, validatePersonalData, validateProfilePhoto, validateRegistration, validateUserLocation, type TipoUsuario } from './validation.js';

export type PublicUserLocation = { cidade: string; estado: string; latitude: number; longitude: number };
export type PublicUser = {
  id: string;
  nome: string;
  email: string;
  tipo: TipoUsuario;
  cnpj: string | null;
  localizacao: PublicUserLocation | null;
};
type UserRow = RowDataPacket & PublicUser & {
  senha_hash: string;
  ativo: number;
  localizacao_cidade: string | null;
  localizacao_estado: string | null;
  localizacao_latitude: number | null;
  localizacao_longitude: number | null;
};
type ProfilePhotoRow = RowDataPacket & { mime_type: string; conteudo: Buffer };
type PersonalDataRow = RowDataPacket & {
  nome_cifrado: Buffer;
  sobrenome_cifrado: Buffer | null;
  cpf_cifrado: Buffer | null;
  data_nascimento_cifrada: Buffer | null;
  endereco_cifrado: Buffer | null;
  tipo_sanguineo_cifrado: Buffer | null;
  genero_cifrado: Buffer | null;
  telefone_cifrado: Buffer | null;
};
export type PersonalData = ReturnType<typeof validatePersonalData>;
const userSelect = `SELECT CAST(u.id AS CHAR) AS id, u.email, u.tipo, u.ativo, u.senha_hash,
  CASE WHEN u.tipo = 'DOADOR' THEN d.nome ELSE o.nome END AS nome, o.cnpj,
  l.cidade AS localizacao_cidade, l.estado AS localizacao_estado,
  l.latitude AS localizacao_latitude, l.longitude AS localizacao_longitude
  FROM usuarios u
  LEFT JOIN perfis_doador d ON d.usuario_id = u.id
  LEFT JOIN perfis_ong o ON o.usuario_id = u.id
  LEFT JOIN localizacoes_usuario l ON l.usuario_id = u.id`;

function publicUser(user: UserRow): PublicUser {
  const localizacao = user.localizacao_cidade && user.localizacao_estado &&
    Number.isFinite(user.localizacao_latitude) && Number.isFinite(user.localizacao_longitude)
    ? {
        cidade: user.localizacao_cidade,
        estado: user.localizacao_estado,
        latitude: Number(user.localizacao_latitude),
        longitude: Number(user.localizacao_longitude)
      }
    : null;
  return { id: user.id, nome: user.nome, email: user.email, tipo: user.tipo, cnpj: user.cnpj, localizacao };
}

export async function register(body: unknown): Promise<PublicUser> {
  const input = validateRegistration(body);
  const passwordHash = await hashPassword(input.senha);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute<ResultSetHeader>(
      'INSERT INTO usuarios (email, senha_hash, tipo) VALUES (?, ?, ?)',
      [input.email, passwordHash, input.tipo]
    );
    const id = String(result.insertId);
    if (input.tipo === 'ONG') {
      await connection.execute('INSERT INTO perfis_ong (usuario_id, nome, cnpj) VALUES (?, ?, ?)', [id, input.nome, input.cnpj]);
    } else {
      await connection.execute('INSERT INTO perfis_doador (usuario_id, nome) VALUES (?, ?)', [id, input.nome]);
    }
    await connection.commit();
    return { id, nome: input.nome, email: input.email, tipo: input.tipo, cnpj: input.cnpj, localizacao: null };
  } catch (error) {
    await connection.rollback();
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
      throw new AuthError(409, 'E-mail ou CNPJ já cadastrado.');
    }
    throw error;
  } finally {
    connection.release();
  }
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function login(body: unknown) {
  const input = validateLogin(body);
  const [rows] = await database.execute<UserRow[]>(`${userSelect} WHERE u.email = ? LIMIT 1`, [input.email]);
  const user = rows[0];
  const valid = await verifyPassword(input.senha, user?.senha_hash ?? dummyHash);
  if (!valid || !user || !user.ativo || user.tipo !== input.tipo || !user.nome) {
    throw new AuthError(401, 'E-mail ou senha incorretos para o perfil selecionado.');
  }
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await database.execute('DELETE FROM sessoes WHERE usuario_id = ? AND expira_em <= UTC_TIMESTAMP(3)', [user.id]);
  await database.execute('INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)', [tokenHash(token), user.id, expiresAt]);
  return { token, expiresAt: expiresAt.toISOString(), usuario: publicUser(user) };
}

export async function currentUser(token: string): Promise<PublicUser> {
  const [rows] = await database.execute<UserRow[]>(`${userSelect}
    INNER JOIN sessoes s ON s.usuario_id = u.id
    WHERE s.token_hash = ? AND s.expira_em > UTC_TIMESTAMP(3) AND u.ativo = 1`, [tokenHash(token)]);
  if (!rows[0] || !rows[0].nome) throw new AuthError(401, 'Sessão expirada. Entre novamente.');
  return publicUser(rows[0]);
}

export async function updateUserLocation(token: string, body: unknown): Promise<PublicUser> {
  const user = await currentUser(token);
  const localizacao = validateUserLocation(body);
  await database.execute(
    `INSERT INTO localizacoes_usuario (usuario_id, cidade, estado, latitude, longitude)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE cidade = VALUES(cidade), estado = VALUES(estado),
       latitude = VALUES(latitude), longitude = VALUES(longitude), atualizada_em = CURRENT_TIMESTAMP(3)`,
    [user.id, localizacao.cidade, localizacao.estado, localizacao.latitude, localizacao.longitude]
  );
  return currentUser(token);
}

export async function updateProfilePhoto(token: string, body: unknown, mimeType: unknown): Promise<void> {
  const user = await currentUser(token);
  const foto = validateProfilePhoto(body, mimeType);
  await database.execute(
    `INSERT INTO fotos_perfil (usuario_id, mime_type, conteudo)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE mime_type = VALUES(mime_type), conteudo = VALUES(conteudo),
       atualizada_em = CURRENT_TIMESTAMP(3)`,
    [user.id, foto.mimeType, foto.conteudo]
  );
}

export async function profilePhoto(token: string): Promise<{ mimeType: string; conteudo: Buffer } | null> {
  const user = await currentUser(token);
  const [rows] = await database.execute<ProfilePhotoRow[]>(
    'SELECT mime_type, conteudo FROM fotos_perfil WHERE usuario_id = ? LIMIT 1',
    [user.id]
  );
  const foto = rows[0];
  return foto ? { mimeType: foto.mime_type, conteudo: foto.conteudo } : null;
}

export async function updatePassword(token: string, body: unknown): Promise<void> {
  const user = await currentUser(token);
  const input = validatePasswordUpdate(body);
  const [rows] = await database.execute<(RowDataPacket & { senha_hash: string })[]>(
    'SELECT senha_hash FROM usuarios WHERE id = ? LIMIT 1',
    [user.id]
  );
  if (!rows[0] || !await verifyPassword(input.senhaAtual, rows[0].senha_hash)) {
    throw new AuthError(400, 'A senha atual está incorreta.');
  }
  const novaHash = await hashPassword(input.novaSenha);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [novaHash, user.id]);
    await connection.execute(
      'DELETE FROM sessoes WHERE usuario_id = ? AND token_hash <> ?',
      [user.id, tokenHash(token)]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function splitDisplayName(displayName: string): { nome: string; sobrenome: string | null } {
  const parts = displayName.trim().split(/\s+/);
  return { nome: parts.shift() ?? displayName, sobrenome: parts.join(' ') || null };
}

function personalDataFromRow(userId: string, row: PersonalDataRow): PersonalData {
  return {
    nome: decryptPersonalData(userId, 'nome', row.nome_cifrado) ?? '',
    sobrenome: decryptPersonalData(userId, 'sobrenome', row.sobrenome_cifrado),
    cpf: decryptPersonalData(userId, 'cpf', row.cpf_cifrado),
    dataNascimento: decryptPersonalData(userId, 'dataNascimento', row.data_nascimento_cifrada),
    endereco: decryptPersonalData(userId, 'endereco', row.endereco_cifrado),
    tipoSanguineo: decryptPersonalData(userId, 'tipoSanguineo', row.tipo_sanguineo_cifrado),
    genero: decryptPersonalData(userId, 'genero', row.genero_cifrado),
    telefone: decryptPersonalData(userId, 'telefone', row.telefone_cifrado)
  };
}

export async function personalData(token: string): Promise<PersonalData> {
  const user = await currentUser(token);
  if (user.tipo !== 'DOADOR') throw new AuthError(403, 'Cadastro pessoal disponível apenas para doadores.');
  const [rows] = await database.execute<PersonalDataRow[]>(
    `SELECT nome_cifrado, sobrenome_cifrado, cpf_cifrado, data_nascimento_cifrada,
       endereco_cifrado, tipo_sanguineo_cifrado, genero_cifrado, telefone_cifrado
     FROM dados_pessoais_usuario WHERE usuario_id = ? LIMIT 1`,
    [user.id]
  );
  return rows[0]
    ? personalDataFromRow(user.id, rows[0])
    : { ...splitDisplayName(user.nome), cpf: null, dataNascimento: null, endereco: null, tipoSanguineo: null, genero: null, telefone: null };
}

export async function updatePersonalData(token: string, body: unknown): Promise<{ dadosPessoais: PersonalData; usuario: PublicUser }> {
  const user = await currentUser(token);
  if (user.tipo !== 'DOADOR') throw new AuthError(403, 'Cadastro pessoal disponível apenas para doadores.');
  const input = validatePersonalData(body);
  const encrypted = {
    nome: encryptPersonalData(user.id, 'nome', input.nome),
    sobrenome: encryptPersonalData(user.id, 'sobrenome', input.sobrenome),
    cpf: encryptPersonalData(user.id, 'cpf', input.cpf),
    dataNascimento: encryptPersonalData(user.id, 'dataNascimento', input.dataNascimento),
    endereco: encryptPersonalData(user.id, 'endereco', input.endereco),
    tipoSanguineo: encryptPersonalData(user.id, 'tipoSanguineo', input.tipoSanguineo),
    genero: encryptPersonalData(user.id, 'genero', input.genero),
    telefone: encryptPersonalData(user.id, 'telefone', input.telefone)
  };
  const displayName = [input.nome, input.sobrenome].filter(Boolean).join(' ');
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO dados_pessoais_usuario
         (usuario_id, nome_cifrado, sobrenome_cifrado, cpf_cifrado, data_nascimento_cifrada,
          endereco_cifrado, tipo_sanguineo_cifrado, genero_cifrado, telefone_cifrado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE nome_cifrado = VALUES(nome_cifrado), sobrenome_cifrado = VALUES(sobrenome_cifrado),
         cpf_cifrado = VALUES(cpf_cifrado), data_nascimento_cifrada = VALUES(data_nascimento_cifrada),
         endereco_cifrado = VALUES(endereco_cifrado), tipo_sanguineo_cifrado = VALUES(tipo_sanguineo_cifrado),
         genero_cifrado = VALUES(genero_cifrado), telefone_cifrado = VALUES(telefone_cifrado),
         atualizada_em = CURRENT_TIMESTAMP(3)`,
      [user.id, encrypted.nome, encrypted.sobrenome, encrypted.cpf, encrypted.dataNascimento,
        encrypted.endereco, encrypted.tipoSanguineo, encrypted.genero, encrypted.telefone]
    );
    await connection.execute('UPDATE perfis_doador SET nome = ? WHERE usuario_id = ?', [displayName, user.id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return { dadosPessoais: input, usuario: await currentUser(token) };
}

export async function logout(token: string): Promise<void> {
  await database.execute('DELETE FROM sessoes WHERE token_hash = ?', [tokenHash(token)]);
}
