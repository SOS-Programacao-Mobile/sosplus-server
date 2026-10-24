import test from 'node:test';
import assert from 'node:assert/strict';
import { singleOngAddress } from '../dist/database/migrations/021-single-ong-address.js';
import { campaignPublicationMeta } from '../dist/database/migrations/022-campaign-publication-meta.js';
import { simulatedWalletIdempotency } from '../dist/database/migrations/023-simulated-wallet-idempotency.js';

test('sede única barra dados legados com endereços duplicados antes do DDL', async () => {
  const statements = [];
  const connection = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes('GROUP BY ong_id')) return [[{ ong_id: '12' }]];
      return [[], []];
    }
  };
  await assert.rejects(singleOngAddress.up(connection), /ONGs com mais de um endereço: 12/);
  assert.equal(statements.some((sql) => sql.includes('ALTER TABLE')), false);
});

test('sede única instala a constraint quando os endereços são compatíveis', async () => {
  const statements = [];
  const connection = {
    async query(sql) {
      statements.push(sql);
      return [[], []];
    }
  };
  await singleOngAddress.up(connection);
  assert.equal(statements.some((sql) => sql.includes('ADD UNIQUE KEY uk_enderecos_ong_sede')), true);
  assert.equal(statements.some((sql) => sql.includes('ck_enderecos_ong_coordenadas')), true);
});

test('meta positiva barra campanhas legadas publicadas inválidas antes do DDL', async () => {
  const statements = [];
  const connection = { async query(sql) { statements.push(sql); return sql.includes('meta_valor <= 0') ? [[{ id: '31' }]] : [[], []]; } };
  await assert.rejects(campaignPublicationMeta.up(connection), /campanhas publicadas com meta não positiva: 31/);
  assert.equal(statements.some((sql) => sql.includes('ALTER TABLE')), false);
});

test('meta positiva permite meta zero somente em rascunho', async () => {
  const statements = [];
  const connection = { async query(sql) { statements.push(sql); return [[], []]; } };
  await campaignPublicationMeta.up(connection);
  assert.match(statements.at(-1), /meta_valor > 0 OR status = 'RASCUNHO'/);
});

test('carteira e chave idempotente toleram nova execução após DDL parcial', async () => {
  const statements = [];
  let column = false;
  let index = false;
  const connection = { async query(sql) {
    statements.push(sql);
    if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return [column ? [{ COLUMN_NAME: 'chave_operacao' }] : [], []];
    if (sql.includes('INFORMATION_SCHEMA.STATISTICS')) return [index ? [{ INDEX_NAME: 'uk_doacoes_doador_chave' }] : [], []];
    if (sql.includes('ADD COLUMN chave_operacao')) column = true;
    if (sql.includes('ADD UNIQUE KEY uk_doacoes_doador_chave')) index = true;
    return [[], []];
  } };
  await simulatedWalletIdempotency.up(connection);
  await simulatedWalletIdempotency.up(connection);
  assert.equal(statements.filter((sql) => sql.includes('CREATE TABLE IF NOT EXISTS carteiras_simuladas')).length, 2);
  assert.equal(statements.filter((sql) => sql.includes('ADD COLUMN chave_operacao')).length, 1);
  assert.equal(statements.filter((sql) => sql.includes('ADD UNIQUE KEY uk_doacoes_doador_chave')).length, 1);
});
