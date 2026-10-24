import { database } from '../mysql.js';
import type { RowDataPacket } from 'mysql2';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptPersonalData, encryptPersonalData, fingerprintPersonalData } from '../../security/personal-data.js';
import { normalizeCpf, validCpf } from '../../auth/validation.js';

type LegacyDonor = RowDataPacket & {
  id: string;
  nome: string;
  cpf: string | null;
  cpf_hash: Buffer | null;
  cpf_cifrado: Buffer | null;
  has_personal_data: number;
};

export async function backfillCpfIndex(): Promise<number> {
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<LegacyDonor[]>(`
      SELECT CAST(p.usuario_id AS CHAR) id, p.nome, p.cpf, p.cpf_hash,
        d.cpf_cifrado, d.usuario_id IS NOT NULL has_personal_data
      FROM perfis_doador p
      LEFT JOIN dados_pessoais_usuario d ON d.usuario_id = p.usuario_id
      ORDER BY p.usuario_id FOR UPDATE
    `);
    const updates: Array<{ row: LegacyDonor; cpf: string; hash: Buffer; encrypted: Buffer }> = [];
    const owners = new Map<string, string>();

    for (const row of rows) {
      let legacy: string | null;
      let encrypted: string | null;
      try {
        legacy = row.cpf?.trim() ? normalizeCpf(row.cpf) : null;
        encrypted = row.cpf_cifrado ? decryptPersonalData(row.id, 'cpf', row.cpf_cifrado) : null;
      } catch {
        throw new Error(`CPF cifrado inválido para usuário ${row.id}; nenhum dado foi alterado.`);
      }
      const protectedCpf = encrypted ? normalizeCpf(encrypted) : null;
      if (legacy && protectedCpf && legacy !== protectedCpf) {
        throw new Error(`CPF divergente para usuário ${row.id}; nenhum dado foi alterado.`);
      }
      const cpf = legacy ?? protectedCpf;
      if (!cpf) {
        if (row.cpf_hash) throw new Error(`Índice CPF sem dado cifrado para usuário ${row.id}; nenhum dado foi alterado.`);
        continue;
      }
      if (!validCpf(cpf)) throw new Error(`CPF inválido para usuário ${row.id}; nenhum dado foi alterado.`);

      const hash = fingerprintPersonalData('cpf', cpf);
      if (row.cpf_hash && !row.cpf_hash.equals(hash)) {
        throw new Error(`Índice CPF divergente para usuário ${row.id}; nenhum dado foi alterado.`);
      }
      const fingerprint = hash.toString('hex');
      const owner = owners.get(fingerprint);
      if (owner && owner !== row.id) {
        throw new Error(`CPF duplicado entre usuários ${owner} e ${row.id}; nenhum dado foi alterado.`);
      }
      owners.set(fingerprint, row.id);
      updates.push({ row, cpf, hash, encrypted: row.cpf_cifrado ?? encryptPersonalData(row.id, 'cpf', cpf)! });
    }

    for (const { row, hash, encrypted } of updates) {
      if (row.has_personal_data) {
        await connection.execute(
          'UPDATE dados_pessoais_usuario SET cpf_cifrado = ? WHERE usuario_id = ?',
          [encrypted, row.id]
        );
      } else {
        await connection.execute(
          'INSERT INTO dados_pessoais_usuario (usuario_id, nome_cifrado, cpf_cifrado) VALUES (?, ?, ?)',
          [row.id, encryptPersonalData(row.id, 'nome', row.nome), encrypted]
        );
      }
      await connection.execute(
        'UPDATE perfis_doador SET cpf_hash = ?, cpf = NULL WHERE usuario_id = ?',
        [hash, row.id]
      );
    }
    await connection.commit();
    return updates.length;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const count = await backfillCpfIndex();
    console.log(`Índice protegido de CPF verificado para ${count} perfil(is); campos legados em texto foram limpos.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Backfill de CPF falhou; nenhum dado foi alterado.');
    process.exitCode = 2;
  } finally {
    await database.end();
  }
}
