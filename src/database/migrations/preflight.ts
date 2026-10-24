import type { RowDataPacket } from 'mysql2';
import { database } from '../mysql.js';
import { decryptPersonalData, fingerprintPersonalData } from '../../security/personal-data.js';
import { normalizeCpf, validCpf } from '../../auth/validation.js';

type CpfRow = RowDataPacket & {
  id: string;
  nome: string;
  cpf: string | null;
  cpf_cifrado: Buffer | null;
};

export async function preflightExistingData(): Promise<void> {
  const [rows] = await database.execute<CpfRow[]>(`
    SELECT CAST(p.usuario_id AS CHAR) id, p.nome, p.cpf, d.cpf_cifrado
    FROM perfis_doador p
    LEFT JOIN dados_pessoais_usuario d ON d.usuario_id = p.usuario_id
    ORDER BY p.usuario_id
  `);
  const conflicts: string[] = [];
  const owners = new Map<string, string>();

  for (const row of rows) {
    let cpf: string | null;
    try {
      const legacy = row.cpf?.trim() ? normalizeCpf(row.cpf) : null;
      const encrypted = row.cpf_cifrado
        ? decryptPersonalData(row.id, 'cpf', row.cpf_cifrado)
        : null;
      const protectedValue = encrypted ? normalizeCpf(encrypted) : null;
      if (legacy && protectedValue && legacy !== protectedValue) {
        conflicts.push(`${row.id}: CPF divergente entre os campos legados`);
        continue;
      }
      cpf = legacy ?? protectedValue;
      if (cpf && !validCpf(cpf)) {
        conflicts.push(`${row.id}: CPF legado inválido`);
        continue;
      }
    } catch {
      conflicts.push(`${row.id}: dado cifrado incompatível com a chave configurada`);
      continue;
    }
    if (cpf) {
      const fingerprint = fingerprintPersonalData('cpf', cpf).toString('hex');
      const previous = owners.get(fingerprint);
      if (previous) conflicts.push(`${previous}, ${row.id}: CPF repetido`);
      else owners.set(fingerprint, row.id);
    }
  }

  const [addresses] = await database.execute<(RowDataPacket & { id: string })[]>(`
    SELECT CAST(ong_id AS CHAR) id FROM enderecos_ong GROUP BY ong_id HAVING COUNT(*) > 1
  `);
  for (const row of addresses) conflicts.push(`${row.id}: mais de um endereço da ONG`);

  const [coordinates] = await database.execute<(RowDataPacket & { id: string })[]>(`
    SELECT CAST(id AS CHAR) id FROM enderecos_ong WHERE (latitude IS NULL) <> (longitude IS NULL)
  `);
  for (const row of coordinates) conflicts.push(`${row.id}: coordenadas incompletas`);

  const [campaigns] = await database.execute<(RowDataPacket & { id: string })[]>(`
    SELECT CAST(id AS CHAR) id FROM campanhas WHERE meta_valor = 0 AND status <> 'RASCUNHO'
  `);
  for (const row of campaigns) conflicts.push(`${row.id}: campanha publicada sem meta positiva`);

  if (conflicts.length) {
    throw new Error(`Migração bloqueada por ${conflicts.length} conflito(s); IDs sem dados pessoais: ${conflicts.join('; ')}`);
  }
  console.log(`Pré-verificação aprovada: ${rows.length} doador(es), sem CPF inválido/duplicado, endereço duplicado ou campanha incompatível.`);
}

try {
  await preflightExistingData();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Pré-verificação de dados falhou.');
  process.exitCode = 2;
} finally {
  await database.end();
}
