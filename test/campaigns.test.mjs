import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCampaign, validateCampaignStatus } from '../dist/campaigns/validation.js';

const valid = { titulo: 'Campanha', descricao: 'Descrição', categoriaId: '2', metaCentavos: 0, inicioEm: '2026-10-23', fimEm: '2026-11-01' };

test('campanha aceita rascunho com meta zero e calendário real', () => {
  assert.equal(validateCampaign(valid).metaCentavos, 0);
  assert.throws(() => validateCampaign({ ...valid, metaCentavos: 1.2 }), /centavos/);
  assert.throws(() => validateCampaign({ ...valid, inicioEm: '2026-02-30' }), /período válido/);
  assert.throws(() => validateCampaign({ ...valid, fimEm: '2026-10-22' }), /período válido/);
});

test('status só aceita estados conhecidos', () => {
  assert.equal(validateCampaignStatus({ status: 'ATIVA' }), 'ATIVA');
  assert.throws(() => validateCampaignStatus({ status: 'PUBLICADA' }), /Status de campanha inválido/);
});
